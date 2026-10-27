"""
公众号历史文章目录 / 阅读进度（书签）模块

解决的问题：
    公众号没有按系列归类，想看 2023 年某个系列的第 11 篇，只能从最新一篇
    一页页往回翻。这里把上游分页列表一次性落成本地索引，之后「目录」是本地的：
    可以按年份折叠、按标题搜索、标记已读、插书签、并从「上次读到」继续。

设计要点：
    1. 索引（article_index/<fakeid>.json）是**可重建的缓存**，丢了重新同步即可；
    2. 阅读状态（reading_state.json）是**用户数据**，单独存放，绝不被同步覆盖；
    3. 文章主键优先用上游 reviewId，退化到链接摘要，保证跨次同步稳定；
    4. 同步在后台线程跑，复用 backend.articles._fetch_articles_page 的分页与
       风控自愈逻辑，前端轮询进度。
"""

import hashlib
import threading
import time
from pathlib import Path

from flask import Blueprint, jsonify, request

from backend.config import DATA_DIR, ACCOUNTS_FILE, load_json, save_json

reading_bp = Blueprint("reading", __name__, url_prefix="/api/reading")

# ── 存储路径 ──────────────────────────────────────────────
INDEX_DIR = DATA_DIR / "article_index"
STATE_FILE = DATA_DIR / "reading_state.json"

# 单次同步的安全上限：避免误操作把上游扫穿
_HARD_PAGE_CAP = 500
_state_lock = threading.RLock()
_sync_lock = threading.Lock()
_sync_tasks = {}


# ── 工具 ──────────────────────────────────────────────────

def article_key(article: dict) -> str:
    """为文章计算稳定主键。

    优先 reviewId（上游唯一），其次规范化后的链接摘要，最后标题+时间。
    同一篇文章在不同次同步、不同入口下必须得到同一个 key。
    """
    rid = str(article.get("id") or article.get("review_id") or "").strip()
    if rid:
        return f"rid:{rid}"

    link = str(article.get("link") or "").strip()
    if link:
        return "url:" + hashlib.md5(link.encode("utf-8")).hexdigest()[:16]

    seed = f"{article.get('title') or ''}|{article.get('publish_time') or article.get('update_time') or 0}"
    return "tt:" + hashlib.md5(seed.encode("utf-8")).hexdigest()[:16]


def _safe_filename(fakeid: str) -> str:
    """把 fakeid 转成安全的文件名（它可能含 Base64 的 + / = 等字符）"""
    cleaned = "".join(c if (c.isalnum() or c in "-_") else "_" for c in str(fakeid))
    return (cleaned or "unknown")[:120] + ".json"


def _index_path(fakeid: str) -> Path:
    return INDEX_DIR / _safe_filename(fakeid)


def load_index(fakeid: str) -> dict:
    """读取某公众号的本地目录索引"""
    data = load_json(_index_path(fakeid), {})
    if not isinstance(data, dict):
        return {}
    if not isinstance(data.get("articles"), list):
        data["articles"] = []
    return data


def save_index(fakeid: str, data: dict):
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    save_json(_index_path(fakeid), data)


def load_state() -> dict:
    """读取全局阅读状态（已读 / 书签 / 上次读到）"""
    state = load_json(STATE_FILE, {})
    if not isinstance(state, dict):
        state = {}
    if not isinstance(state.get("accounts"), dict):
        state["accounts"] = {}
    state.setdefault("version", 1)
    return state


def save_state(state: dict):
    save_json(STATE_FILE, state)


def _account_names() -> dict:
    """fakeid -> 公众号昵称，来自「公众号管理」的收藏列表"""
    names = {}
    raw = load_json(ACCOUNTS_FILE, [])
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict) and item.get("fakeid"):
                names[str(item["fakeid"])] = item.get("nickname") or ""
    return names


def _state_for(state: dict, fakeid: str) -> dict:
    acc = state["accounts"].get(fakeid)
    if not isinstance(acc, dict):
        acc = {}
        state["accounts"][fakeid] = acc
    if not isinstance(acc.get("articles"), dict):
        acc["articles"] = {}
    return acc


def _merge_articles(index: dict, acc_state: dict) -> list:
    """把目录索引与阅读状态合并成前端要的文章列表"""
    marks = acc_state.get("articles") or {}
    last_key = (acc_state.get("last_read") or {}).get("key") or ""

    merged = []
    for item in index.get("articles") or []:
        if not isinstance(item, dict):
            continue
        key = item.get("key") or article_key(item)
        mark = marks.get(key) or {}
        publish_time = item.get("publish_time") or item.get("update_time") or 0
        merged.append({
            "key": key,
            "title": item.get("title") or "",
            "link": item.get("link") or "",
            "cover": item.get("cover") or "",
            "digest": item.get("digest") or "",
            "author": item.get("author") or "",
            "publish_time": publish_time,
            "is_read": bool(mark.get("read")),
            "read_at": mark.get("read_at") or 0,
            "bookmark": bool(mark.get("bookmark")),
            "bookmark_at": mark.get("bookmark_at") or 0,
            "is_last_read": key == last_key,
        })

    # 时间未知（上游置顶推文）排最前，其余按发布时间倒序
    merged.sort(key=lambda a: (0 if not a["publish_time"] else 1, -(a["publish_time"] or 0)))
    return merged


def _stats(articles: list) -> dict:
    total = len(articles)
    read = sum(1 for a in articles if a["is_read"])
    bookmark = sum(1 for a in articles if a["bookmark"])
    return {
        "total": total,
        "read": read,
        "unread": total - read,
        "bookmarks": bookmark,
    }


def _year_summary(articles: list) -> list:
    """按年份汇总，供左侧目录树折叠使用"""
    buckets = {}
    for a in articles:
        ts = a.get("publish_time") or 0
        if ts:
            year = time.strftime("%Y", time.localtime(ts))
        else:
            year = "unknown"
        b = buckets.setdefault(year, {"year": year, "total": 0, "read": 0, "unread": 0})
        b["total"] += 1
        if a["is_read"]:
            b["read"] += 1
        else:
            b["unread"] += 1
    # 年份倒序（新的在前），「未知时间」固定排最后
    return sorted(
        buckets.values(),
        key=lambda x: (x["year"] == "unknown", -_year_number(x["year"])),
    )


def _year_number(year: str) -> int:
    try:
        return int(year)
    except (TypeError, ValueError):
        return 0


# ── 接口：总览 ────────────────────────────────────────────

@reading_bp.route("/overview", methods=["GET"])
def overview():
    """所有关注公众号的阅读进度总览，用于目录页左侧列表"""
    names = _account_names()
    state = load_state()

    fakeids = []
    for fid in names:
        fakeids.append(fid)
    for fid in state["accounts"]:
        if fid not in names:
            fakeids.append(fid)
    # 已建索引但还没收藏的公众号也列出来，避免目录「消失」
    if INDEX_DIR.exists():
        for path in INDEX_DIR.glob("*.json"):
            try:
                data = load_json(path, {})
            except Exception:
                continue
            fid = (data or {}).get("fakeid") or ""
            if fid and fid not in fakeids:
                fakeids.append(fid)

    accounts = []
    for fid in fakeids:
        index = load_index(fid)
        acc_state = state["accounts"].get(fid) or {}
        articles = _merge_articles(index, acc_state)
        stats = _stats(articles)
        last = acc_state.get("last_read") or {}

        accounts.append({
            "fakeid": fid,
            "name": index.get("name") or names.get(fid) or fid,
            "indexed": bool(articles),
            "complete": bool(index.get("complete")),
            "built_at": index.get("built_at") or 0,
            **stats,
            "last_read": {
                "key": last.get("key") or "",
                "title": last.get("title") or "",
                "publish_time": last.get("publish_time") or 0,
                "at": last.get("at") or 0,
            } if last else None,
        })

    # 有进度的排前面，其次是已建索引的
    accounts.sort(key=lambda a: (not a["indexed"], -(a["built_at"] or 0)))
    return jsonify({"accounts": accounts, "total": len(accounts)})


# ── 接口：某公众号的完整目录 ──────────────────────────────

@reading_bp.route("/index", methods=["GET"])
def get_index():
    """返回某公众号的本地目录（含已读/书签状态）。

    列表一次性返回，前端做即时过滤与搜索，避免每次输入都打后端。
    fakeid 用查询参数传递：它可能是含 + / = 的 Base64，放进路径会被拆坏。
    """
    fakeid = str(request.args.get("fakeid") or "").strip()
    if not fakeid:
        return jsonify({"error": "缺少 fakeid"}), 400

    index = load_index(fakeid)
    state = load_state()
    acc_state = state["accounts"].get(fakeid) or {}
    articles = _merge_articles(index, acc_state)
    last = acc_state.get("last_read") or {}

    return jsonify({
        "fakeid": fakeid,
        "name": index.get("name") or _account_names().get(fakeid) or fakeid,
        "indexed": bool(articles),
        "complete": bool(index.get("complete")),
        "built_at": index.get("built_at") or 0,
        "pages_done": index.get("pages_done") or 0,
        "articles": articles,
        "stats": _stats(articles),
        "years": _year_summary(articles),
        "last_read": {
            "key": last.get("key") or "",
            "title": last.get("title") or "",
            "publish_time": last.get("publish_time") or 0,
            "at": last.get("at") or 0,
        } if last else None,
    })


# ── 接口：标记已读 / 书签 ─────────────────────────────────

@reading_bp.route("/mark", methods=["POST"])
def mark():
    """标记单篇文章的已读 / 书签状态。

    body: {fakeid, key, read?: bool, bookmark?: bool, title?, publish_time?}
    把 read 置为 True 时顺带更新「上次读到」，这样点开一篇文章就等于记了位置。
    """
    data = request.get_json() or {}
    fakeid = str(data.get("fakeid") or "").strip()
    key = str(data.get("key") or "").strip()
    if not fakeid or not key:
        return jsonify({"error": "缺少 fakeid 或 key"}), 400

    now = time.time()
    with _state_lock:
        state = load_state()
        acc = _state_for(state, fakeid)
        entry = acc["articles"].get(key) or {}

        if "read" in data:
            is_read = bool(data["read"])
            entry["read"] = is_read
            entry["read_at"] = now if is_read else 0
        if "bookmark" in data:
            is_bookmark = bool(data["bookmark"])
            entry["bookmark"] = is_bookmark
            entry["bookmark_at"] = now if is_bookmark else 0

        if entry:
            acc["articles"][key] = entry

        if entry.get("read") and data.get("touch_last_read", True):
            acc["last_read"] = {
                "key": key,
                "at": now,
                "title": data.get("title") or (acc.get("last_read") or {}).get("title") or "",
                "publish_time": data.get("publish_time") or (acc.get("last_read") or {}).get("publish_time") or 0,
            }

        save_state(state)

    return jsonify({"message": "已更新", "key": key, "mark": entry})


@reading_bp.route("/mark-batch", methods=["POST"])
def mark_batch():
    """批量标记，用于「把这一年标为已读」这类操作。

    body: {fakeid, keys: [...], read?: bool, bookmark?: bool}
    """
    data = request.get_json() or {}
    fakeid = str(data.get("fakeid") or "").strip()
    keys = data.get("keys") or []
    if not fakeid or not isinstance(keys, list) or not keys:
        return jsonify({"error": "缺少 fakeid 或 keys"}), 400

    now = time.time()
    updated = 0
    with _state_lock:
        state = load_state()
        acc = _state_for(state, fakeid)
        for raw_key in keys:
            key = str(raw_key or "").strip()
            if not key:
                continue
            entry = acc["articles"].get(key) or {}
            if "read" in data:
                is_read = bool(data["read"])
                entry["read"] = is_read
                entry["read_at"] = now if is_read else 0
            if "bookmark" in data:
                is_bookmark = bool(data["bookmark"])
                entry["bookmark"] = is_bookmark
                entry["bookmark_at"] = now if is_bookmark else 0
            acc["articles"][key] = entry
            updated += 1
        save_state(state)

    return jsonify({"message": f"已更新 {updated} 篇", "updated": updated})


@reading_bp.route("/last-read", methods=["POST"])
def set_last_read():
    """单独设置「上次读到」的位置（不改变已读状态）。"""
    data = request.get_json() or {}
    fakeid = str(data.get("fakeid") or "").strip()
    key = str(data.get("key") or "").strip()
    if not fakeid or not key:
        return jsonify({"error": "缺少 fakeid 或 key"}), 400

    with _state_lock:
        state = load_state()
        acc = _state_for(state, fakeid)
        acc["last_read"] = {
            "key": key,
            "at": time.time(),
            "title": data.get("title") or "",
            "publish_time": data.get("publish_time") or 0,
        }
        save_state(state)

    return jsonify({"message": "已记录阅读位置"})


@reading_bp.route("/bookmarks", methods=["GET"])
def all_bookmarks():
    """跨公众号汇总所有书签，形成「待读清单」"""
    state = load_state()
    names = _account_names()
    items = []

    for fakeid, acc in state["accounts"].items():
        if not isinstance(acc, dict):
            continue
        marks = acc.get("articles") or {}
        keys = [k for k, v in marks.items() if isinstance(v, dict) and v.get("bookmark")]
        if not keys:
            continue
        index = load_index(fakeid)
        by_key = {}
        for item in index.get("articles") or []:
            if isinstance(item, dict):
                by_key[item.get("key") or article_key(item)] = item
        for key in keys:
            src = by_key.get(key) or {}
            items.append({
                "fakeid": fakeid,
                "account": index.get("name") or names.get(fakeid) or fakeid,
                "key": key,
                "title": src.get("title") or "",
                "link": src.get("link") or "",
                "publish_time": src.get("publish_time") or 0,
                "read": bool((marks.get(key) or {}).get("read")),
                "bookmark_at": (marks.get(key) or {}).get("bookmark_at") or 0,
            })

    items.sort(key=lambda x: x.get("bookmark_at") or 0, reverse=True)
    return jsonify({"bookmarks": items, "total": len(items)})


@reading_bp.route("/reset", methods=["POST"])
def reset_progress():
    """清空某公众号的阅读状态（已读/书签/位置），目录索引保留。"""
    data = request.get_json() or {}
    fakeid = str(data.get("fakeid") or "").strip()
    if not fakeid:
        return jsonify({"error": "缺少 fakeid"}), 400
    with _state_lock:
        state = load_state()
        if fakeid in state["accounts"]:
            state["accounts"].pop(fakeid, None)
            save_state(state)
    return jsonify({"message": "该公众号的阅读状态已重置"})


# ── 接口：同步（建立/更新本地目录） ───────────────────────

@reading_bp.route("/sync", methods=["POST"])
def start_sync():
    """后台拉取公众号历史文章并写入本地目录。

    body: {fakeid, name?, page_size?, max_pages?, full?}
        full=True  重新完整扫描（补齐更早的历史）
        full=False 增量：翻到「整页都是已知文章」就停
    """
    data = request.get_json() or {}
    fakeid = str(data.get("fakeid") or "").strip()
    if not fakeid:
        return jsonify({"error": "缺少 fakeid"}), 400

    name = str(data.get("name") or "").strip() or _account_names().get(fakeid) or ""
    try:
        page_size = int(data.get("page_size") or 20)
    except (TypeError, ValueError):
        page_size = 20
    page_size = max(5, min(page_size, 50))
    try:
        max_pages = int(data.get("max_pages") or 0)
    except (TypeError, ValueError):
        max_pages = 0
    if max_pages <= 0:
        max_pages = _HARD_PAGE_CAP
    max_pages = min(max_pages, _HARD_PAGE_CAP)
    full = bool(data.get("full"))

    task_id = f"sync_{int(time.time() * 1000)}"
    with _sync_lock:
        _sync_tasks[task_id] = {
            "status": "running",
            "fakeid": fakeid,
            "name": name,
            "full": full,
            "pages": 0,
            "fetched": 0,
            "added": 0,
            "total_indexed": 0,
            "message": "准备中…",
            "stop_reason": "",
            "started_at": time.time(),
            "end_at": 0,
        }

    thread = threading.Thread(
        target=_do_sync,
        args=(task_id, fakeid, name, page_size, max_pages, full),
        daemon=True,
    )
    thread.start()

    return jsonify({"task_id": task_id, "message": "已开始同步历史目录"})


@reading_bp.route("/sync-status/<task_id>", methods=["GET"])
def sync_status(task_id):
    with _sync_lock:
        task = _sync_tasks.get(task_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(task)


@reading_bp.route("/sync-cancel/<task_id>", methods=["POST"])
def sync_cancel(task_id):
    with _sync_lock:
        task = _sync_tasks.get(task_id)
        if not task:
            return jsonify({"error": "任务不存在"}), 404
        if task["status"] == "running":
            task["cancel_requested"] = True
    return jsonify({"message": "正在停止同步"})


def _do_sync(task_id: str, fakeid: str, name: str, page_size: int, max_pages: int, full: bool):
    """后台同步线程：分页拉取、合并入索引、保留已有阅读状态。"""
    from backend.articles import _fetch_articles_page

    index = load_index(fakeid)
    existing = {}
    for item in index.get("articles") or []:
        if isinstance(item, dict):
            existing[item.get("key") or article_key(item)] = item

    begin = 0
    pages = 0
    fetched = 0
    added = 0
    stop_reason = ""
    reached_end = False

    try:
        while pages < max_pages:
            with _sync_lock:
                task = _sync_tasks.get(task_id)
                if not task:
                    return
                if task.get("cancel_requested"):
                    task["status"] = "cancelled"
                    task["stop_reason"] = "用户停止"
                    task["end_at"] = time.time()
                    return
                task["message"] = f"正在扫描第 {pages + 1} 页…"

            try:
                page_articles, _total, can_continue = _fetch_articles_page(
                    fakeid, begin, page_size, "", account_name=name
                )
            except Exception as exc:
                stop_reason = f"拉取失败: {exc}"
                break

            pages += 1
            fetched += len(page_articles or [])

            page_added = 0
            for article in page_articles or []:
                key = article_key(article)
                raw = {
                    "key": key,
                    "title": article.get("title") or "",
                    "link": article.get("link") or "",
                    "cover": article.get("cover") or "",
                    "digest": article.get("digest") or "",
                    "author": article.get("author") or "",
                    "publish_time": article.get("publish_time") or article.get("update_time") or 0,
                }
                if key in existing:
                    # 保持目录字段为最新，但不丢已有 key
                    existing[key].update({k: v for k, v in raw.items() if v not in ("", 0, None)})
                else:
                    existing[key] = raw
                    page_added += 1

            added += page_added

            with _sync_lock:
                task = _sync_tasks.get(task_id)
                if task:
                    task["pages"] = pages
                    task["fetched"] = fetched
                    task["added"] = added
                    task["total_indexed"] = len(existing)
                    task["message"] = f"已扫描 {pages} 页，累计 {len(existing)} 篇"

            if not page_articles:
                reached_end = True
                stop_reason = stop_reason or "没有更多文章"
                break

            # 增量模式：整页都是已存在的文章，说明头部已追平，无需再往深处翻
            if not full and page_added == 0:
                reached_end = False
                stop_reason = "已追平最新（整页均为已知文章）"
                break

            if not can_continue:
                reached_end = True
                stop_reason = stop_reason or "已到达最后一页"
                break

            begin += page_size

            from backend.waterwall import is_waterwall_active
            if is_waterwall_active():
                stop_reason = "触发上游风控，已暂停同步，请完成安全验证后重试"
                break

            # 温和节流，避免连续翻页触發频控
            time.sleep(1.0 + (pages % 4) * 0.2)

        articles = sorted(
            existing.values(),
            key=lambda a: (0 if not a.get("publish_time") else 1, -(a.get("publish_time") or 0)),
        )
        index.update({
            "fakeid": fakeid,
            "name": name or index.get("name") or "",
            "articles": articles,
            "built_at": index.get("built_at") or time.time(),
            "updated_at": time.time(),
            "pages_done": pages,
            "complete": bool(reached_end) or bool(index.get("complete")),
        })
        save_index(fakeid, index)

        with _sync_lock:
            task = _sync_tasks.get(task_id)
            if task:
                task["status"] = "completed"
                task["stop_reason"] = stop_reason
                task["total_indexed"] = len(articles)
                task["message"] = f"完成，共 {len(articles)} 篇"
                task["end_at"] = time.time()

    except Exception as exc:
        with _sync_lock:
            task = _sync_tasks.get(task_id)
            if task:
                task["status"] = "failed"
                task["stop_reason"] = f"同步异常: {exc}"
                task["message"] = "同步失败"
                task["end_at"] = time.time()

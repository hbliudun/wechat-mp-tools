/**
 * 阅读目录页面组件
 *
 * 把关注的公众号历史文章整理成本地目录，解决「一个系列看到第 10 篇，
 * 下次要从哪接着看」的问题：
 *   - 左侧：公众号列表 + 阅读进度 + 上次读到
 *   - 右侧：按年份折叠的目录，支持即时搜索、已读/未读筛选、书签
 *   - 「继续阅读」直接定位到上次读的那一篇
 */
const ReadingPage = {
    accounts: [],
    currentFakeid: '',
    data: null,
    filter: 'all',
    keyword: '',
    collapsedYears: new Set(),
    syncTaskId: null,
    _pollTimer: null,
    _highlightKey: '',

    // ── 渲染 ──────────────────────────────────────────

    render() {
        return `
            <style>
                .reading-layout {
                    display: flex;
                    gap: 0;
                    margin-top: 12px;
                    border: 1px solid var(--border-color);
                    border-radius: var(--radius-lg);
                    background: var(--bg-card);
                    overflow: hidden;
                    height: calc(100vh - 170px);
                }
                .reading-side {
                    width: 300px;
                    min-width: 300px;
                    border-right: 1px solid var(--border-color);
                    display: flex;
                    flex-direction: column;
                    background: var(--bg-secondary);
                }
                .reading-side-header {
                    padding: 12px var(--spacing-md);
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 8px;
                }
                .reading-side-title {
                    font-size: 0.92rem;
                    font-weight: 700;
                    color: var(--text-primary);
                }
                .reading-account-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .reading-account-card {
                    padding: 10px 12px;
                    border-radius: var(--radius-md);
                    background: var(--bg-glass);
                    border: 1px solid var(--border-color);
                    cursor: pointer;
                    transition: all var(--transition-normal);
                }
                .reading-account-card:hover {
                    border-color: var(--border-hover);
                    background: var(--bg-glass-hover);
                }
                .reading-account-card.active {
                    border-color: var(--primary);
                    background: var(--primary-glow);
                }
                .reading-account-name {
                    font-size: 0.88rem;
                    font-weight: 600;
                    color: var(--text-primary);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .reading-account-bar {
                    height: 4px;
                    border-radius: 2px;
                    background: var(--bg-input);
                    margin: 7px 0 5px;
                    overflow: hidden;
                }
                .reading-account-bar > i {
                    display: block;
                    height: 100%;
                    background: var(--primary);
                    border-radius: 2px;
                    transition: width var(--transition-normal);
                }
                .reading-account-meta {
                    font-size: 0.7rem;
                    color: var(--text-muted);
                    display: flex;
                    justify-content: space-between;
                    gap: 6px;
                }
                .reading-account-last {
                    font-size: 0.7rem;
                    color: var(--text-secondary);
                    margin-top: 5px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .reading-main {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }
                .reading-toolbar {
                    padding: 10px var(--spacing-md);
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    flex-wrap: wrap;
                    align-items: center;
                    gap: 8px;
                }
                .reading-search {
                    flex: 1;
                    min-width: 160px;
                    padding: 7px 10px;
                    border-radius: var(--radius-sm);
                    border: 1px solid var(--border-color);
                    background: var(--bg-input);
                    color: var(--text-primary);
                    font-size: 0.85rem;
                    outline: none;
                }
                .reading-chip {
                    padding: 5px 12px;
                    border-radius: 999px;
                    border: 1px solid var(--border-color);
                    background: var(--bg-input);
                    color: var(--text-secondary);
                    font-size: 0.78rem;
                    cursor: pointer;
                    transition: all var(--transition-fast);
                    white-space: nowrap;
                }
                .reading-chip.active {
                    background: var(--primary);
                    border-color: var(--primary);
                    color: #fff;
                }
                .reading-articles {
                    flex: 1;
                    overflow-y: auto;
                    padding: 8px var(--spacing-md) 24px;
                }
                .reading-year {
                    margin-top: 4px;
                }
                .reading-year-header {
                    position: sticky;
                    top: 0;
                    z-index: 2;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 9px 6px;
                    background: var(--bg-card);
                    border-bottom: 1px dashed var(--border-color);
                    cursor: pointer;
                    user-select: none;
                }
                .reading-year-header:hover .reading-year-name {
                    color: var(--primary);
                }
                .reading-year-arrow {
                    font-size: 0.75rem;
                    color: var(--text-muted);
                    width: 12px;
                }
                .reading-year-name {
                    font-size: 0.95rem;
                    font-weight: 700;
                    color: var(--text-primary);
                }
                .reading-year-stat {
                    font-size: 0.72rem;
                    color: var(--text-muted);
                }
                .reading-year-actions {
                    margin-left: auto;
                    display: flex;
                    gap: 6px;
                }
                .reading-year-actions button {
                    font-size: 0.7rem;
                    padding: 2px 8px;
                    border-radius: var(--radius-sm);
                    border: 1px solid var(--border-color);
                    background: transparent;
                    color: var(--text-muted);
                    cursor: pointer;
                }
                .reading-year-actions button:hover {
                    color: var(--primary);
                    border-color: var(--primary);
                }
                .reading-article {
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    padding: 9px 8px;
                    border-radius: var(--radius-sm);
                    border-bottom: 1px solid var(--border-color);
                    transition: background var(--transition-fast);
                }
                .reading-article:hover {
                    background: var(--bg-glass-hover);
                }
                .reading-article.is-last {
                    background: var(--primary-glow);
                    border-left: 3px solid var(--primary);
                    padding-left: 6px;
                }
                .reading-article.flash {
                    animation: reading-flash 1.6s ease-out;
                }
                @keyframes reading-flash {
                    0% { background: var(--primary); }
                    100% { background: transparent; }
                }
                .reading-mark {
                    width: 18px;
                    flex-shrink: 0;
                    text-align: center;
                    font-size: 0.7rem;
                    line-height: 20px;
                    color: var(--text-muted);
                    cursor: pointer;
                }
                .reading-article.is-read .reading-mark {
                    color: var(--success, #22c55e);
                }
                .reading-body {
                    flex: 1;
                    min-width: 0;
                }
                .reading-title {
                    font-size: 0.87rem;
                    font-weight: 600;
                    color: var(--text-primary);
                    text-decoration: none;
                    line-height: 1.45;
                    display: block;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .reading-title:hover {
                    color: var(--primary);
                    text-decoration: underline;
                }
                .reading-article.is-read .reading-title {
                    color: var(--text-muted);
                    font-weight: 400;
                }
                .reading-meta {
                    font-size: 0.7rem;
                    color: var(--text-muted);
                    margin-top: 3px;
                    display: flex;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                .reading-badge {
                    font-size: 0.65rem;
                    padding: 1px 6px;
                    border-radius: 999px;
                    background: var(--bg-input);
                    color: var(--text-secondary);
                }
                .reading-badge.last {
                    background: var(--primary);
                    color: #fff;
                }
                .reading-actions {
                    display: flex;
                    gap: 4px;
                    flex-shrink: 0;
                }
                .reading-icon-btn {
                    width: 26px;
                    height: 26px;
                    border-radius: var(--radius-sm);
                    border: 1px solid transparent;
                    background: transparent;
                    cursor: pointer;
                    font-size: 0.85rem;
                    line-height: 1;
                    color: var(--text-muted);
                    opacity: 0.65;
                    transition: all var(--transition-fast);
                }
                .reading-icon-btn:hover {
                    opacity: 1;
                    border-color: var(--border-color);
                    background: var(--bg-input);
                }
                .reading-icon-btn.on {
                    opacity: 1;
                    color: var(--warning, #f59e0b);
                }
                .reading-sync-state {
                    font-size: 0.72rem;
                    color: var(--text-muted);
                    max-width: 320px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .reading-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 12px;
                    height: 100%;
                    color: var(--text-muted);
                    text-align: center;
                    padding: 20px;
                }
                .reading-empty-icon {
                    font-size: 2.4rem;
                    opacity: 0.75;
                }
                body.wechat-theme .reading-account-card.active {
                    border-color: #576b95 !important;
                    background: rgba(87, 107, 149, 0.08) !important;
                }
                body.wechat-theme .reading-account-bar > i {
                    background: #576b95;
                }
                body.wechat-theme .reading-year-name {
                    color: #1f2329;
                }
            </style>

            <div class="page-header" style="margin-bottom: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 12px;">
                    <div>
                        <h2 class="page-title">阅读目录</h2>
                        <p class="page-description">本地历史文章目录，标记已读与书签，随时从上次读到的地方继续</p>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary btn-sm" onclick="ReadingPage.showAllBookmarks()">📌 全部书签</button>
                    </div>
                </div>
            </div>

            <div class="reading-layout">
                <div class="reading-side">
                    <div class="reading-side-header">
                        <span class="reading-side-title">关注的公众号</span>
                        <span class="badge badge-info" id="reading-account-count" style="font-size: 0.7rem;">0</span>
                    </div>
                    <div id="reading-account-list" class="reading-account-list">
                        <div class="loading-screen" style="min-height: 80px;"><div class="spinner"></div></div>
                    </div>
                </div>

                <div class="reading-main">
                    <div class="reading-toolbar" id="reading-toolbar" style="display: none;">
                        <input type="text" class="reading-search" id="reading-search-input"
                               placeholder="搜索标题…（即时过滤本地目录）"
                               oninput="ReadingPage.onSearch(this.value)">
                        <button class="reading-chip active" data-filter="all" onclick="ReadingPage.setFilter('all')">全部</button>
                        <button class="reading-chip" data-filter="unread" onclick="ReadingPage.setFilter('unread')">未读</button>
                        <button class="reading-chip" data-filter="read" onclick="ReadingPage.setFilter('read')">已读</button>
                        <button class="reading-chip" data-filter="bookmark" onclick="ReadingPage.setFilter('bookmark')">📌 书签</button>
                        <button class="btn btn-primary btn-sm" onclick="ReadingPage.startSync(false)" id="reading-sync-btn">🔄 增量更新</button>
                        <button class="btn btn-secondary btn-sm" onclick="ReadingPage.startSync(true)" id="reading-resync-btn" title="从头完整扫描，补齐更早的历史">全量重建</button>
                        <span class="reading-sync-state" id="reading-sync-state"></span>
                    </div>
                    <div id="reading-articles" class="reading-articles">
                        <div class="reading-empty">
                            <div class="reading-empty-icon">📚</div>
                            <p>从左侧选择一个公众号，开始整理它的历史文章目录</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // ── 生命周期 ──────────────────────────────────────

    async init(params = {}) {
        this._restoreLocalState();
        await this.loadOverview();

        // 支持从「下载历史」等页面按公众号名称跳进来（那边只有昵称，没有 fakeid）
        const wanted = params.fakeid
            || this._fakeidForName(params.account || params.name)
            || this.currentFakeid;
        if (wanted) {
            await this.selectAccount(wanted);
        }
    },

    _fakeidForName(name) {
        if (!name) return '';
        const hit = this.accounts.find(acc => acc.name === name);
        return hit ? hit.fakeid : '';
    },

    destroy() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },

    _restoreLocalState() {
        try {
            const stored = JSON.parse(localStorage.getItem('reading_ui_state') || '{}');
            this.collapsedYears = new Set(stored.collapsedYears || []);
            this.filter = stored.filter || 'all';
            this.keyword = stored.keyword || '';
            this.currentFakeid = stored.fakeid || '';
        } catch (err) {
            this.collapsedYears = new Set();
        }
    },

    _saveLocalState() {
        try {
            localStorage.setItem('reading_ui_state', JSON.stringify({
                collapsedYears: [...this.collapsedYears],
                filter: this.filter,
                keyword: this.keyword,
                fakeid: this.currentFakeid,
            }));
        } catch (err) {
            // localStorage 不可用（隐私模式）时静默降级
        }
    },

    // ── 公众号列表 ────────────────────────────────────

    async loadOverview() {
        const container = document.getElementById('reading-account-list');
        try {
            const data = await API.reading.overview();
            this.accounts = data.accounts || [];
            this.renderAccounts();

            const countEl = document.getElementById('reading-account-count');
            if (countEl) countEl.textContent = this.accounts.length;
        } catch (err) {
            if (container) {
                container.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:0.8rem;">加载失败：${this.escapeHtml(err.message || '')}</div>`;
            }
        }
    },

    renderAccounts() {
        const container = document.getElementById('reading-account-list');
        if (!container) return;

        if (this.accounts.length === 0) {
            container.innerHTML = `
                <div style="padding: 16px 10px; color: var(--text-muted); font-size: 0.8rem; line-height: 1.6;">
                    还没有关注的公众号。<br>
                    请先到 <a href="#accounts" style="color: var(--primary); text-decoration: none;">公众号管理</a> 收藏几个公众号。
                </div>
            `;
            return;
        }

        container.innerHTML = this.accounts.map((acc, idx) => {
            const percent = acc.total > 0 ? Math.round((acc.read / acc.total) * 100) : 0;
            const isActive = acc.fakeid === this.currentFakeid;
            const lastTitle = acc.last_read && acc.last_read.title
                ? `上次读到：《${this.escapeHtml(acc.last_read.title)}》`
                : (acc.indexed ? '还没有阅读记录' : '未建立目录');
            const progressText = acc.indexed
                ? `已读 ${acc.read}/${acc.total} · 📌 ${acc.bookmarks}`
                : '点击右侧「增量更新」建立目录';

            return `
                <div class="reading-account-card ${isActive ? 'active' : ''}" onclick="ReadingPage.selectAccountByIndex(${idx})">
                    <div class="reading-account-name" title="${this.escapeHtml(acc.name)}">${this.escapeHtml(acc.name)}</div>
                    <div class="reading-account-bar"><i style="width:${percent}%"></i></div>
                    <div class="reading-account-meta">
                        <span>${progressText}</span>
                        <span>${acc.indexed ? acc.unread + ' 未读' : ''}</span>
                    </div>
                    <div class="reading-account-last" title="${lastTitle}">${lastTitle}</div>
                </div>
            `;
        }).join('');
    },

    selectAccountByIndex(idx) {
        const acc = this.accounts[idx];
        if (!acc) return;
        this.selectAccount(acc.fakeid);
    },

    async selectAccount(fakeid) {
        this.currentFakeid = fakeid;
        this._pendingJump = true;
        this.renderAccounts();
        this._saveLocalState();

        const toolbar = document.getElementById('reading-toolbar');
        if (toolbar) toolbar.style.display = 'flex';
        const searchInput = document.getElementById('reading-search-input');
        if (searchInput && searchInput.value !== this.keyword) searchInput.value = this.keyword;
        this.updateChipUI();

        this.setArticlesLoading();
        try {
            const data = await API.reading.index(fakeid);
            this.data = data;

            if (!data.indexed) {
                this.renderNotIndexed(data);
                return;
            }
            this.renderDirectory();
        } catch (err) {
            const container = document.getElementById('reading-articles');
            if (container) {
                container.innerHTML = `
                    <div class="reading-empty">
                        <div class="reading-empty-icon">⚠️</div>
                        <p>${this.escapeHtml(err.message || '加载目录失败')}</p>
                        <button class="btn btn-secondary btn-sm" onclick="ReadingPage.selectAccount('${this._jsSafe(this.currentFakeid)}')">重试</button>
                    </div>
                `;
            }
        }
    },

    setArticlesLoading() {
        const container = document.getElementById('reading-articles');
        if (container) {
            container.innerHTML = '<div class="loading-screen" style="min-height:140px;"><div class="spinner"></div><p>加载目录…</p></div>';
        }
    },

    renderNotIndexed(data) {
        const container = document.getElementById('reading-articles');
        if (!container) return;
        container.innerHTML = `
            <div class="reading-empty">
                <div class="reading-empty-icon">🗂️</div>
                <h3 style="color: var(--text-primary); font-size: 1.05rem; margin: 0;">【${this.escapeHtml(data.name || '')}】还没有本地目录</h3>
                <p style="max-width: 460px; line-height: 1.7; font-size: 0.84rem;">
                    建立目录会把该公众号的历史文章列表抓取一次并保存在本地。之后翻看、搜索、标记已读都不再请求上游，不会触发风控。<br>
                    文章多的公众号首次同步需要几分钟，可以先去忙别的。
                </p>
                <div style="display: flex; gap: 10px; margin-top: 4px;">
                    <button class="btn btn-primary btn-sm" onclick="ReadingPage.startSync(true)">开始建立目录</button>
                </div>
                <span class="reading-sync-state" id="reading-sync-state"></span>
            </div>
        `;
    },

    // ── 目录渲染 ──────────────────────────────────────

    getFilteredArticles() {
        if (!this.data) return [];
        const keyword = this.keyword.trim().toLowerCase();
        return (this.data.articles || []).filter(article => {
            if (this.filter === 'unread' && article.is_read) return false;
            if (this.filter === 'read' && !article.is_read) return false;
            if (this.filter === 'bookmark' && !article.bookmark) return false;
            if (keyword) {
                const haystack = `${article.title || ''} ${article.digest || ''} ${article.author || ''}`.toLowerCase();
                if (!haystack.includes(keyword)) return false;
            }
            return true;
        });
    },

    renderDirectory() {
        const container = document.getElementById('reading-articles');
        if (!container) return;

        const filtered = this.getFilteredArticles();
        const stats = this.data ? (this.data.stats || {}) : {};

        if (filtered.length === 0) {
            const hasAny = this.data && (this.data.articles || []).length > 0;
            container.innerHTML = `
                <div class="reading-empty">
                    <div class="reading-empty-icon">${hasAny ? '🔍' : '📭'}</div>
                    <p>${hasAny ? '当前筛选条件下没有文章' : '这个目录里还没有任何文章'}</p>
                    ${hasAny ? '<button class="btn btn-secondary btn-sm" onclick="ReadingPage.resetFilter()">清除筛选</button>' : ''}
                </div>
            `;
            return;
        }

        // 按年份分组（保持后端已排好的时间倒序）
        const groups = [];
        let currentGroup = null;
        filtered.forEach(article => {
            const year = article.publish_time
                ? String(new Date(article.publish_time * 1000).getFullYear())
                : 'unknown';
            if (!currentGroup || currentGroup.year !== year) {
                currentGroup = { year, articles: [] };
                groups.push(currentGroup);
            }
            currentGroup.articles.push(article);
        });

        const lastReadKey = (this.data.last_read && this.data.last_read.key) || '';

        let html = `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 6px 4px;flex-wrap:wrap;">
                <span style="font-size:0.78rem;color:var(--text-muted);">
                    共 ${stats.total || 0} 篇 · 已读 ${stats.read || 0} · 未读 ${stats.unread || 0} · 书签 ${stats.bookmarks || 0}
                    ${this.data.complete ? '' : '<span class="reading-badge">目录尚未完整</span>'}
                </span>
                ${lastReadKey ? `<button class="btn btn-primary btn-sm" style="margin-left:auto;" onclick="ReadingPage.jumpToLastRead()">▶ 继续阅读</button>` : ''}
            </div>
        `;

        groups.forEach(group => {
            const collapsed = this.collapsedYears.has(group.year);
            const readCount = group.articles.filter(a => a.is_read).length;
            const label = group.year === 'unknown' ? '时间未知' : `${group.year} 年`;
            const arrow = collapsed ? '▶' : '▼';

            html += `
                <div class="reading-year" data-year="${group.year}">
                    <div class="reading-year-header" onclick="ReadingPage.toggleYear('${group.year}')">
                        <span class="reading-year-arrow">${arrow}</span>
                        <span class="reading-year-name">${label}</span>
                        <span class="reading-year-stat">${group.articles.length} 篇 · 已读 ${readCount}</span>
                        <span class="reading-year-actions">
                            <button onclick="event.stopPropagation(); ReadingPage.markYearRead('${group.year}', true)">整年标已读</button>
                            <button onclick="event.stopPropagation(); ReadingPage.markYearRead('${group.year}', false)">整年标未读</button>
                        </span>
                    </div>
                    ${collapsed ? '' : group.articles.map(article => this.renderArticleRow(article, lastReadKey)).join('')}
                </div>
            `;
        });

        const scrollTop = container.scrollTop;
        container.innerHTML = html;
        container.scrollTop = scrollTop;

        // 首次进入某个公众号时，自动定位到上次读到的位置
        if (this._pendingJump) {
            this._pendingJump = false;
            if (lastReadKey) this.jumpToLastRead();
        }
    },

    renderArticleRow(article, lastReadKey) {
        const dateStr = article.publish_time
            ? new Date(article.publish_time * 1000).toLocaleDateString('zh-CN')
            : '时间未知';
        const isLast = article.key === lastReadKey || article.is_last_read;
        const key = this.escapeHtml(article.key);

        // 注意：key 通过 data-key 传递，不拼进内联 JS 字符串，
        // 否则含引号的 reviewId 会被 HTML 实体解码后破坏脚本。
        return `
            <div class="reading-article ${article.is_read ? 'is-read' : ''} ${isLast ? 'is-last' : ''}"
                 data-key="${key}" id="reading-row-${this.escapeHtml(this._domId(article.key))}">
                <span class="reading-mark" title="${article.is_read ? '已读，点击标为未读' : '未读，点击标为已读'}"
                      onclick="ReadingPage.toggleRead(this.closest('.reading-article').dataset.key, event)">${article.is_read ? '✔' : '○'}</span>
                <div class="reading-body">
                    <a class="reading-title" href="${this.escapeHtml(article.link || '#')}" target="_blank" rel="noopener noreferrer"
                       title="${this.escapeHtml(article.title || '')}"
                       onclick="ReadingPage.onTitleClick(this.closest('.reading-article').dataset.key, event)">${this.escapeHtml(article.title || '无标题')}</a>
                    <div class="reading-meta">
                        <span>📅 ${dateStr}</span>
                        ${article.author ? `<span>✍️ ${this.escapeHtml(article.author)}</span>` : ''}
                        ${article.bookmark ? '<span class="reading-badge">📌 书签</span>' : ''}
                        ${isLast ? '<span class="reading-badge last">上次读到</span>' : ''}
                    </div>
                </div>
                <div class="reading-actions">
                    <button class="reading-icon-btn ${article.bookmark ? 'on' : ''}" title="书签"
                            onclick="ReadingPage.toggleBookmark(this.closest('.reading-article').dataset.key, event)">📌</button>
                    <button class="reading-icon-btn" title="复制链接"
                            onclick="ReadingPage.copyLink(this.closest('.reading-article').dataset.key, event)">🔗</button>
                </div>
            </div>
        `;
    },

    // ── 交互：筛选 / 搜索 / 折叠 ──────────────────────

    onSearch(value) {
        this.keyword = value || '';
        this._saveLocalState();
        this.renderDirectory();
    },

    setFilter(filter) {
        this.filter = filter;
        this.updateChipUI();
        this._saveLocalState();
        this.renderDirectory();
    },

    updateChipUI() {
        document.querySelectorAll('.reading-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.filter === this.filter);
        });
    },

    resetFilter() {
        this.keyword = '';
        this.filter = 'all';
        const input = document.getElementById('reading-search-input');
        if (input) input.value = '';
        this.updateChipUI();
        this._saveLocalState();
        this.renderDirectory();
    },

    toggleYear(year) {
        if (this.collapsedYears.has(year)) {
            this.collapsedYears.delete(year);
        } else {
            this.collapsedYears.add(year);
        }
        this._saveLocalState();

        const group = document.querySelector(`.reading-year[data-year="${year}"]`);
        if (!group) {
            this.renderDirectory();
            return;
        }
        // 只改当前年份的 DOM，避免整表重绘导致滚动跳动
        const collapsed = this.collapsedYears.has(year);
        const arrow = group.querySelector('.reading-year-arrow');
        if (arrow) arrow.textContent = collapsed ? '▶' : '▼';

        const rows = group.querySelectorAll('.reading-article');
        rows.forEach(row => { row.style.display = collapsed ? 'none' : ''; });
    },

    // ── 交互：已读 / 书签 ─────────────────────────────

    findArticle(key) {
        if (!this.data) return null;
        return (this.data.articles || []).find(a => a.key === key) || null;
    },

    async toggleRead(key, event) {
        if (event) event.stopPropagation();
        const article = this.findArticle(key);
        if (!article) return;
        await this.applyMark(article, { read: !article.is_read });
    },

    async toggleBookmark(key, event) {
        if (event) event.stopPropagation();
        const article = this.findArticle(key);
        if (!article) return;
        await this.applyMark(article, { bookmark: !article.bookmark });
    },

    async applyMark(article, changes) {
        const payload = {
            fakeid: this.currentFakeid,
            key: article.key,
            title: article.title,
            publish_time: article.publish_time,
            ...changes,
        };
        // 乐观更新，交互不等网络
        if ('read' in changes) article.is_read = changes.read;
        if ('bookmark' in changes) article.bookmark = changes.bookmark;
        if (article.is_read) this._markAsLastRead(article);

        this.refreshStats();
        this.renderDirectory();

        try {
            await API.reading.mark(payload);
        } catch (err) {
            // 回滚
            if ('read' in changes) article.is_read = !changes.read;
            if ('bookmark' in changes) article.bookmark = !changes.bookmark;
            this.refreshStats();
            this.renderDirectory();
        }
    },

    _markAsLastRead(article) {
        if (!this.data) return;
        this.data.last_read = {
            key: article.key,
            title: article.title,
            publish_time: article.publish_time,
            at: Math.floor(Date.now() / 1000),
        };
        // 同步左侧卡片上的「上次读到」
        const acc = this.accounts.find(a => a.fakeid === this.currentFakeid);
        if (acc) {
            acc.last_read = { ...this.data.last_read };
            acc.read = (this.data.articles || []).filter(a => a.is_read).length;
            this.renderAccounts();
        }
    },

    refreshStats() {
        if (!this.data) return;
        const articles = this.data.articles || [];
        this.data.stats = {
            total: articles.length,
            read: articles.filter(a => a.is_read).length,
            unread: articles.filter(a => !a.is_read).length,
            bookmarks: articles.filter(a => a.bookmark).length,
        };
        const acc = this.accounts.find(a => a.fakeid === this.currentFakeid);
        if (acc) {
            acc.total = this.data.stats.total;
            acc.read = this.data.stats.read;
            acc.unread = this.data.stats.unread;
            acc.bookmarks = this.data.stats.bookmarks;
        }
    },

    async markYearRead(year, isRead) {
        if (!this.data) return;
        const keys = (this.data.articles || [])
            .filter(a => {
                const y = a.publish_time ? String(new Date(a.publish_time * 1000).getFullYear()) : 'unknown';
                return y === year;
            })
            .map(a => a.key);

        if (keys.length === 0) return;

        const label = isRead ? '已读' : '未读';
        Modal.confirm('批量标记', `把 ${year === 'unknown' ? '时间未知' : year + ' 年'} 的 ${keys.length} 篇文章标记为${label}？`, async () => {
            (this.data.articles || []).forEach(a => {
                if (keys.includes(a.key)) a.is_read = isRead;
            });
            this.refreshStats();
            this.renderDirectory();
            try {
                await API.reading.markBatch({ fakeid: this.currentFakeid, keys, read: isRead });
                Toast.success(`已标记 ${keys.length} 篇为${label}`);
            } catch (err) {
                await this.selectAccount(this.currentFakeid);
            }
        });
    },

    // ── 交互：打开文章 ────────────────────────────────

    async onTitleClick(key, event) {
        const article = this.findArticle(key);
        if (!article) return;

        // 关键：这里不能同步重绘整个列表，否则 <a> 会在默认跳转触发前被移出 DOM。
        // 只就地更新这一行的样式，整表刷新延后到新标签页已经打开之后。
        if (!article.is_read) {
            article.is_read = true;
            article.read_at = Math.floor(Date.now() / 1000);
        }
        this.refreshStats();
        this._markAsLastRead(article);

        const row = document.getElementById(`reading-row-${this._domId(article.key)}`);
        if (row) {
            row.classList.add('is-read');
            const mark = row.querySelector('.reading-mark');
            if (mark) {
                mark.textContent = '✔';
                mark.title = '已读，点击标为未读';
            }
        }
        setTimeout(() => this.renderDirectory(), 400);

        try {
            await API.reading.mark({
                fakeid: this.currentFakeid,
                key: article.key,
                read: true,
                title: article.title,
                publish_time: article.publish_time,
            });
        } catch (err) {
            // 打开文章是主操作，记录失败不打断阅读
        }

        if (!article.link && event) event.preventDefault();
    },

    copyLink(key, event) {
        if (event) event.stopPropagation();
        const article = this.findArticle(key);
        if (!article || !article.link) {
            Toast.warning('这篇文章没有可用链接');
            return;
        }
        navigator.clipboard.writeText(article.link)
            .then(() => Toast.success('链接已复制'))
            .catch(() => Toast.error('复制失败'));
    },

    jumpToLastRead() {
        if (!this.data || !this.data.last_read) return;
        const key = this.data.last_read.key;

        // 如果当前筛选把目标藏起来了，先重置筛选
        const visible = this.getFilteredArticles().some(a => a.key === key);
        if (!visible) {
            this.resetFilter();
        }

        const row = document.getElementById(`reading-row-${this._domId(key)}`);
        if (!row) {
            Toast.info('上次读到的文章不在当前目录中，可能目录还没同步到那么早');
            return;
        }
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1800);
    },

    // ── 同步 ──────────────────────────────────────────

    async startSync(full) {
        if (!this.currentFakeid) {
            Toast.warning('请先选择公众号');
            return;
        }
        const acc = this.accounts.find(a => a.fakeid === this.currentFakeid);
        const name = (this.data && this.data.name) || (acc && acc.name) || '';

        this.setSyncState('正在启动同步…');
        this.setSyncButtonsDisabled(true);

        try {
            const res = await API.reading.sync({
                fakeid: this.currentFakeid,
                name,
                full: !!full,
                page_size: 20,
            });
            this.syncTaskId = res.task_id;
            this.startSyncPolling();
        } catch (err) {
            this.setSyncState('');
            this.setSyncButtonsDisabled(false);
        }
    },

    setSyncButtonsDisabled(disabled) {
        ['reading-sync-btn', 'reading-resync-btn'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = disabled;
        });
    },

    setSyncState(text) {
        const el = document.getElementById('reading-sync-state');
        if (el) el.textContent = text || '';
    },

    startSyncPolling() {
        if (this._pollTimer) clearInterval(this._pollTimer);

        this._pollTimer = setInterval(async () => {
            if (!this.syncTaskId) return;
            let task;
            try {
                task = await API.reading.syncStatus(this.syncTaskId);
            } catch (err) {
                return;
            }

            if (task.message) {
                this.setSyncState(`${task.message}${task.stop_reason ? ' · ' + task.stop_reason : ''}`);
            }

            if (['completed', 'failed', 'cancelled'].includes(task.status)) {
                clearInterval(this._pollTimer);
                this._pollTimer = null;
                this.syncTaskId = null;
                this.setSyncButtonsDisabled(false);

                if (task.status === 'completed') {
                    Toast.success(`目录已更新，共 ${task.total_indexed || 0} 篇`);
                } else if (task.status === 'cancelled') {
                    Toast.info('同步已停止');
                } else {
                    Toast.error(task.stop_reason || '同步失败');
                }

                await this.loadOverview();
                await this.selectAccount(this.currentFakeid);
            }
        }, 1200);
    },

    // ── 全部书签 ──────────────────────────────────────

    async showAllBookmarks() {
        let data;
        try {
            data = await API.reading.bookmarks();
        } catch (err) {
            return;
        }

        const items = data.bookmarks || [];
        if (items.length === 0) {
            Modal.open({
                title: '📌 全部书签',
                content: '<p style="color:var(--text-muted);font-size:0.85rem;">还没有任何书签。在目录里点文章右侧的 📌 就能收藏到这里，形成跨公众号的待读清单。</p>',
                footer: '<button class="btn btn-secondary btn-sm" onclick="Modal.close()">关闭</button>',
            });
            return;
        }

        const content = `
            <div style="max-height: 60vh; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
                ${items.map(item => `
                    <div style="display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid var(--border-color);border-radius:8px;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.86rem;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                                 title="${this.escapeHtml(item.title)}">
                                ${item.read ? '✔ ' : ''}${this.escapeHtml(item.title || '无标题')}
                            </div>
                            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">
                                ${this.escapeHtml(item.account || '')} ·
                                ${item.publish_time ? new Date(item.publish_time * 1000).toLocaleDateString('zh-CN') : '时间未知'}
                            </div>
                        </div>
                        <button class="btn btn-secondary btn-sm" style="font-size:0.72rem;padding:3px 9px;"
                                onclick="ReadingPage.openBookmark(${this.escapeHtml(JSON.stringify(item.fakeid))}, ${this.escapeHtml(JSON.stringify(item.link || ''))})">打开</button>
                    </div>
                `).join('')}
            </div>
        `;

        Modal.open({
            title: `📌 全部书签（${items.length}）`,
            content,
            footer: '<button class="btn btn-secondary btn-sm" onclick="Modal.close()">关闭</button>',
        });
    },

    openBookmark(fakeid, link) {
        Modal.close();
        if (link) window.open(link, '_blank', 'noopener');
        if (fakeid) {
            this.selectAccount(fakeid);
        }
    },

    // ── 工具 ──────────────────────────────────────────

    escapeHtml(text) {
        return String(text == null ? '' : text).replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    },

    _jsSafe(text) {
        return String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    },

    _domId(key) {
        return String(key).replace(/[^A-Za-z0-9_-]/g, '_');
    },
};

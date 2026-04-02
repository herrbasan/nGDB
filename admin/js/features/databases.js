// admin/js/features/databases.js — Databases registered feature
// Shows ALL databases (loaded + unloaded) with load/unload controls

import { ndbApi } from '../api.js';

export async function handleDatabasesPage(container, params, nuiInstance) {
	const nui = window.nui || nuiInstance;
	container.innerHTML = '';

	const page = document.createElement('div');
	page.innerHTML = `
		<header class="page-header">
			<h1>Databases</h1>
			<p class="lead">Manage nDB document databases — load, unload, and browse</p>
		</header>
		<div id="content" class="flex-col">
			<p>Loading...</p>
		</div>
	`;
	container.appendChild(page);

	const content = page.querySelector('#content');

	async function refresh() {
		const result = await ndbApi.list();
		const allDbs = result.databases || [];

		const loadedDbs = allDbs.filter(db => db.loaded);
		const unloadedDbs = allDbs.filter(db => !db.loaded);

		let html = '';

		// ── Loaded Databases ──
		html += `<h2>Loaded Databases (${loadedDbs.length})</h2>`;

		if (loadedDbs.length === 0) {
			html += `<p class="text-muted">No databases are currently loaded.</p>`;
		} else {
			html += `<div class="flex-col">`;
			for (const db of loadedDbs) {
				html += `
					<div class="db-card">
						<div class="db-card__row">
							<div class="db-card__info">
								<span class="status-dot status-dot--loaded" title="Loaded">●</span>
								<div>
									<div class="db-card__name">${escapeHtml(db.name)}</div>
									<div class="db-card__path">${escapeHtml(db.path)}</div>
								</div>
							</div>
							<div class="db-card__badges">
								<nui-badge>${db.docCount} docs</nui-badge>
								${db.trash && db.trash.exists && db.trash.count > 0 ? `<nui-badge variant="warning" title="${db.trash.count} documents in trash">🗑 ${db.trash.count}</nui-badge>` : ''}
							</div>
						</div>
						<div class="db-card__actions">
							<nui-button class="view-docs-btn" data-handle="${escapeHtml(db.handle)}"><button>View Documents</button></nui-button>
							${db.trash && db.trash.exists && db.trash.count > 0 ? `<nui-button class="view-trash-btn" data-handle="${escapeHtml(db.handle)}" variant="warning"><button>View Trash</button></nui-button>` : ''}
							<nui-button class="unload-db-btn" data-handle="${escapeHtml(db.handle)}" data-path="${escapeHtml(db.path)}" variant="warning"><button>Unload</button></nui-button>
						</div>
					</div>
				`;
			}
			html += `</div>`;
		}

		// ── Unloaded Databases ──
		html += `<h2 class="mt-lg">Available Databases (${unloadedDbs.length})</h2>`;

		if (unloadedDbs.length === 0) {
			html += `<p class="text-muted">All discovered databases are loaded.</p>`;
		} else {
			html += `<div class="flex-col">`;
			for (const db of unloadedDbs) {
				const sizeStr = db.size ? formatBytes(db.size) : '—';
				const modStr = db.modified ? new Date(db.modified).toLocaleString() : '—';
				html += `
					<div class="db-card db-card--unloaded">
						<div class="db-card__row">
							<div class="db-card__info">
								<span class="status-dot status-dot--unloaded" title="Not loaded">○</span>
								<div>
									<div class="db-card__name">${escapeHtml(db.name)}</div>
									<div class="db-card__meta">${sizeStr} · ${modStr}</div>
								</div>
							</div>
						</div>
						<div class="db-card__actions">
							<nui-button class="load-db-btn" data-path="${escapeHtml(db.path)}"><button>Load</button></nui-button>
						</div>
					</div>
				`;
			}
			html += `</div>`;
		}

		// ── Manual Open ──
		html += `
			<div class="mt-lg" style="padding-top: 1rem; border-top: 1px solid var(--nui-border);">
				<nui-button id="open-db-btn"><button>+ Open Database by Path</button></nui-button>
				<p class="text-small text-muted mt-sm">
					Enter a database path (relative to data folder or absolute) to open a database not in the standard location.
				</p>
			</div>
		`;

		content.innerHTML = html;

		// View documents buttons
		content.querySelectorAll('.view-docs-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				const handle = btn.dataset.handle;
				window.location.hash = `#feature=documents&handle=${handle}`;
			});
		});

		// View trash buttons — navigate to documents page with trash accordion open
		content.querySelectorAll('.view-trash-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				const handle = btn.dataset.handle;
				window.location.hash = `#feature=documents&handle=${handle}&trash=open`;
			});
		});

		// Unload database buttons
		content.querySelectorAll('.unload-db-btn').forEach(btn => {
			btn.addEventListener('click', async () => {
				const handle = btn.dataset.handle;
				const dbPath = btn.dataset.path;
				try {
					await ndbApi.unload(handle);
					nui.components.banner.show({ content: `Unloaded ${dbPath}`, priority: 'success', autoClose: 2000 });
					refresh();
				} catch (err) {
					nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
				}
			});
		});

		// Load database buttons
		content.querySelectorAll('.load-db-btn').forEach(btn => {
			btn.addEventListener('click', async () => {
				const dbPath = btn.dataset.path;
				try {
					await ndbApi.load(dbPath);
					nui.components.banner.show({ content: `Loaded ${dbPath}`, priority: 'success', autoClose: 2000 });
					refresh();
				} catch (err) {
					nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
				}
			});
		});

		// Open database by path button
		const openBtn = content.querySelector('#open-db-btn');
		if (openBtn) {
			openBtn.addEventListener('click', async () => {
				const result = await nui.components.dialog.prompt('Open Database', 'Enter database path:', {
					fields: [{ id: 'path', label: 'Path', value: 'mydb' }]
				});
				if (result && result.path) {
					try {
						await ndbApi.open(result.path);
						nui.components.banner.show({ content: `Opened ${result.path}`, priority: 'success', autoClose: 2000 });
						refresh();
					} catch (err) {
						nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
					}
				}
			});
		}
	}

	try {
		await refresh();
	} catch (err) {
		content.innerHTML = `<p style="color: var(--nui-danger);">Error: ${err.message}</p>`;
	}
}

function escapeHtml(str) {
	if (str == null) return '';
	return String(str).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

function formatBytes(bytes) {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

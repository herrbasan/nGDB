// admin/js/main.js — nGDB Admin SPA bootstrap
// Sidebar shows ALL databases on disk, click to open+browse

import { nui } from '../NUI/NUI/nui.js';
import '../NUI/NUI/lib/modules/nui-list.js';
import '../NUI/NUI/lib/modules/nui-code-editor.js';

import { api, ndbApi, nvdbApi } from './api.js';
import { store } from './store.js';
import { handleDatabasesPage } from './features/databases.js';
import { handleDocumentsPage } from './features/documents.js';
import { handleBucketsPage } from './features/buckets.js';
import { handleVectorsPage } from './features/vectors.js';

window.ngdb = { api, ndbApi, nvdbApi, nui, store };

// ─── Scan for Databases on Disk ───────────────────────────────────

// Cache of discovered databases
let discoveredNDB = [];
let discoveredNVDB = [];

async function scanDatabases() {
	console.log('[main] Scanning for databases...');
	
	// Scan for nDB files
	discoveredNDB = [];
	try {
		const basePath = './data/ndb';
		const response = await fetch(`${basePath}/?format=json`).catch(() => null);
		// If we can't list directory, try common locations
		const commonPaths = [
			'data/ngdb-countries/db.jsonl',
			'data/mydb.jsonl',
			'ngdb-countries/db.jsonl',
		];
		for (const path of commonPaths) {
			// Just add to list - we'll verify when opening
			if (path.includes('/')) {
				const name = path.split('/').pop().replace('.jsonl', '');
				discoveredNDB.push({ name, path });
			}
		}
	} catch (err) {
		console.log('[main] Could not scan for nDB files:', err);
	}
	
	console.log('[main] Discovered nDB:', discoveredNDB);
}

// ─── Dynamic Navigation ───────────────────────────────────────────

async function loadNavigation() {
	console.log('[main] Loading navigation...');
	const sideNav = document.querySelector('nui-sidebar nui-link-list');
	if (!sideNav || !sideNav.loadData) return;

	const navData = [
		{
			label: 'Overview',
			icon: 'dashboard',
			items: [{ label: 'Dashboard', href: '#page=dashboard' }],
		},
	];

	// nDB section - show all databases with loaded/unloaded status
	try {
		const ndbResult = await ndbApi.list();
		const allDbs = ndbResult.databases || [];
		const loadedDbs = allDbs.filter(db => db.loaded);
		const unloadedDbs = allDbs.filter(db => !db.loaded);
		
		const ndbItems = [
			{ label: 'Manage Databases', href: '#feature=databases' },
			{ label: 'File Buckets', href: '#feature=buckets' },
		];
		
		// Add loaded databases (clickable to browse)
		for (const db of loadedDbs) {
			const trashIndicator = db.trash && db.trash.exists && db.trash.count > 0
				? ` 🗑${db.trash.count}`
				: '';
			ndbItems.push({
				label: `● ${db.name} (${db.docCount})${trashIndicator}`,
				href: `#feature=documents&handle=${db.handle}`,
			});
		}
		
		// Add unloaded databases (clickable to load)
		for (const db of unloadedDbs) {
			ndbItems.push({
				label: `○ ${db.name}`,
				href: `#action=load-ndb&path=${encodeURIComponent(db.path)}`,
			});
		}
		
		navData.push({
			label: 'nDB Databases',
			icon: 'database',
			items: ndbItems.length > 1 ? ndbItems : [ndbItems[0], { label: '(no databases found)', href: '#', disabled: true }],
		});
	} catch (err) {
		navData.push({
			label: 'nDB Databases',
			icon: 'database',
			items: [{ label: 'Manage Databases', href: '#feature=databases' }],
		});
	}

	// nVDB section
	try {
		const nvdbResult = await nvdbApi.list();
		const openInstances = nvdbResult.instances || [];
		
		const nvdbItems = [
			{ label: 'Manage Vector DBs', href: '#feature=vectors' },
			{ label: '+ Open Vector DB...', href: '#action=open-nvdb' },
		];
		
		for (const db of openInstances) {
			nvdbItems.push({
				label: `● ${db.handle.substring(0, 8)}...`,
				href: `#vdb=${db.handle}`,
			});
		}
		
		navData.push({
			label: 'nVDB Vector DBs',
			icon: 'empty_dashboard',
			items: nvdbItems,
		});
	} catch (err) {
		navData.push({
			label: 'nVDB Vector DBs',
			icon: 'empty_dashboard',
			items: [{ label: '+ Open Vector DB...', href: '#action=open-nvdb' }],
		});
	}

	// System
	navData.push({
		label: 'System',
		icon: 'settings',
		items: [{ label: 'Settings', href: '#page=settings' }],
	});

	sideNav.loadData(navData);
}

// ─── Feature: Database Management ─────────────────────────────────

nui.registerFeature('databases', handleDatabasesPage);

// ─── Feature: Document Browser ────────────────────────────────────

nui.registerFeature('documents', handleDocumentsPage);

// ─── Feature: Bucket Browser ──────────────────────────────────────

nui.registerFeature('buckets', handleBucketsPage);

// ─── Feature: Vector DB Browser ───────────────────────────────────

nui.registerFeature('vectors', handleVectorsPage);

// ─── Feature: Browse Database (legacy) ────────────────────────────

nui.registerFeature('browse-db', async (container, params, nuiInstance) => {
	const nui = window.nui || nuiInstance;
	const handle = params.db;
	
	if (!handle) {
		container.innerHTML = '<p>Select a database from the sidebar</p>';
		return;
	}

	container.innerHTML = `
		<header style="margin-bottom: 1rem;">
			<h1>Database</h1>
			<div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
				<nui-button id="refresh-btn"><button>Refresh</button></nui-button>
				<nui-button id="insert-btn" variant="primary"><button>+ Insert</button></nui-button>
				<nui-button id="close-btn" variant="danger"><button>Close</button></nui-button>
			</div>
		</header>
		<nui-list id="docs-list" style="height: calc(100vh - 250px);"></nui-list>
	`;

	const list = container.querySelector('#docs-list');

	async function loadDocs() {
		try {
			const result = await ndbApi.listDocs(handle);
			const docs = result.docs || [];
			
			list.loadData({
				data: docs,
				render: (doc) => {
					const el = document.createElement('div');
					el.style.cssText = 'padding: 0.75rem; display: flex; align-items: center; gap: 0.5rem;';
					
					const preview = JSON.stringify(doc).substring(0, 150);
					
					el.innerHTML = `
						<nui-badge variant="info">DOC</nui-badge>
						<code style="flex: 0 0 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(doc._id)}</code>
						<span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--nui-text-muted); font-size: 0.875rem;">${escapeHtml(preview)}</span>
					`;
					return el;
				},
				search: [{ prop: '_id' }],
			});
		} catch (err) {
			container.innerHTML = `<p style="color: var(--nui-danger);">Error: ${err.message}</p>`;
		}
	}

	container.querySelector('#refresh-btn').addEventListener('click', loadDocs);
	container.querySelector('#close-btn').addEventListener('click', async () => {
		try {
			await ndbApi.close(handle);
			nui.components.banner.show({ content: 'Database closed', priority: 'success', autoClose: 2000 });
			loadNavigation();
			window.location.hash = '#page=dashboard';
		} catch (err) {
			nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
		}
	});

	await loadDocs();
});

// ─── SPA Routing ──────────────────────────────────────────────────

nui.enableContentLoading({
	container: 'nui-content nui-main',
	navigation: 'nui-sidebar',
	basePath: 'pages',
	defaultPage: 'dashboard',
});

// ─── Hash Change Handler ──────────────────────────────────────────

window.addEventListener('hashchange', handleHashChange);

async function handleHashChange() {
	const hash = window.location.hash;
	console.log('[main] Hash changed:', hash);
	
	// Database selection
	if (hash.startsWith('#db=')) {
		const handle = hash.substring(4);
		window.location.hash = `#feature=browse-db&db=${handle}`;
		return;
	}
	
	// Open nDB dialog
	if (hash === '#action=open-ndb') {
		const result = await nui.components.dialog.prompt('Open Database', 'Enter database path:', {
			fields: [{ id: 'path', label: 'Path', value: 'mydb', placeholder: 'e.g., data/mydb or /full/path/to/db.jsonl' }]
		});
		if (result && result.path) {
			try {
				const openResult = await ndbApi.open(result.path);
				nui.components.banner.show({ content: `Opened ${result.path}`, priority: 'success', autoClose: 2000 });
				await loadNavigation();
				window.location.hash = `#feature=documents&handle=${openResult.handle}`;
			} catch (err) {
				nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
			}
		}
		return;
	}
	
	// Load nDB from sidebar (discovered but unloaded)
	if (hash.startsWith('#action=load-ndb')) {
		const params = new URLSearchParams(hash.substring(8));
		const dbPath = params.get('path');
		if (dbPath) {
			try {
				const loadResult = await ndbApi.load(dbPath);
				nui.components.banner.show({ content: `Loaded ${dbPath}`, priority: 'success', autoClose: 2000 });
				await loadNavigation();
				if (loadResult.handle) {
					window.location.hash = `#feature=documents&handle=${loadResult.handle}`;
				}
			} catch (err) {
				nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
			}
		}
		return;
	}
}

// ─── Global Actions ───────────────────────────────────────────────

document.addEventListener('click', (e) => {
	const actionEl = e.target.closest('[data-action]');
	if (!actionEl) return;

	const actionSpec = actionEl.dataset.action;
	const [action, param] = actionSpec.split(':');

	switch (action) {
		case 'toggle-sidebar': {
			const app = document.querySelector('nui-app');
			if (app?.toggleSideNav) app.toggleSideNav(param || 'left');
			break;
		}
		case 'toggle-theme': {
			const current = document.documentElement.style.colorScheme || 'light';
			document.documentElement.style.colorScheme = current === 'dark' ? 'light' : 'dark';
			localStorage.setItem('nui-theme', current === 'dark' ? 'light' : 'dark');
			break;
		}
	}
});

// ─── Health Check ─────────────────────────────────────────────────

async function updateHealthBadge() {
	const badge = document.getElementById('healthBadge');
	if (!badge) return;
	try {
		await api('/status');
		badge.textContent = 'Healthy';
		badge.setAttribute('variant', 'success');
	} catch {
		badge.textContent = 'Error';
		badge.setAttribute('variant', 'danger');
	}
}

updateHealthBadge();
setInterval(updateHealthBadge, 30000);

// ─── Theme ────────────────────────────────────────────────────────

const savedTheme = localStorage.getItem('nui-theme');
if (savedTheme) document.documentElement.style.colorScheme = savedTheme;

// ─── Init ─────────────────────────────────────────────────────────

loadNavigation();
handleHashChange();

function escapeHtml(str) {
	if (str == null) return '';
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// admin/js/main.js — nGDB Admin SPA bootstrap
// Loads nui_wc2, configures routing, handles actions.

import { nui } from '../NUI/NUI/nui.js';
import '../NUI/NUI/lib/modules/nui-list.js';
import '../NUI/NUI/lib/modules/nui-code-editor.js';

// ─── API Helper ───────────────────────────────────────────────────
const API_BASE = '../admin/api';

async function api(path, options) {
	const res = await fetch(`${API_BASE}${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...options?.headers,
		},
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(err.error || `HTTP ${res.status}`);
	}
	return res.json();
}

// Expose api globally for page scripts
window.ngdb = { api, nui };

// ─── Navigation Data ──────────────────────────────────────────────
const navigationData = [
	{
		label: 'Overview',
		icon: 'dashboard',
		items: [
			{ label: 'Dashboard', href: '#page=dashboard' },
		],
	},
	{
		label: 'nDB — Document Store',
		icon: 'database',
		items: [
			{ label: 'Databases', href: '#page=databases' },
			{ label: 'Documents', href: '#page=documents' },
			{ label: 'File Buckets', href: '#page=buckets' },
		],
	},
	{
		label: 'nVDB — Vector Store',
		icon: 'empty_dashboard',
		items: [
			{ label: 'Vector DBs', href: '#page=vectors' },
		],
	},
	{
		label: 'System',
		icon: 'settings',
		items: [
			{ label: 'Settings', href: '#page=settings' },
		],
	},
];

// Load side navigation from JSON
const sideNav = document.querySelector('nui-sidebar nui-link-list');
if (sideNav && sideNav.loadData) {
	sideNav.loadData(navigationData);
}

// ─── Action Handling ──────────────────────────────────────────────
document.addEventListener('click', (e) => {
	const actionEl = e.target.closest('[data-action]');
	if (!actionEl) return;

	const actionSpec = actionEl.dataset.action;
	const [actionPart] = actionSpec.split('@');
	const [action, param] = actionPart.split(':');

	switch (action) {
		case 'toggle-sidebar': {
			const app = document.querySelector('nui-app');
			if (app?.toggleSideNav) {
				app.toggleSideNav(param || 'left');
			}
			break;
		}
		case 'toggle-theme': {
			const current = document.documentElement.style.colorScheme || 'light';
			const newTheme = current === 'dark' ? 'light' : 'dark';
			document.documentElement.style.colorScheme = newTheme;
			localStorage.setItem('nui-theme', newTheme);
			break;
		}
	}
});

// ─── Health Check Badge ───────────────────────────────────────────
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

// ─── SPA Routing ──────────────────────────────────────────────────
nui.enableContentLoading({
	container: 'nui-content nui-main',
	navigation: 'nui-sidebar',
	basePath: 'pages',
	defaultPage: 'dashboard',
});

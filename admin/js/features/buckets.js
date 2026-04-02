// admin/js/features/buckets.js — Buckets registered feature
// File bucket browser with trash management

import { ndbApi } from '../api.js';
import { store } from '../store.js';

/**
 * Handle the Buckets feature page
 * @param {HTMLElement} container - The container element
 * @param {object} params - URL parameters
 * @param {object} nui - NUI library reference
 */
export async function handleBucketsPage(container, params, nuiInstance) {
	const nui = window.nui || nuiInstance;
	container.innerHTML = '';

	let currentHandle = params.handle || store.currentNdbHandle;

	const page = document.createElement('div');
	page.className = 'page-buckets';
	page.innerHTML = `
		<header style="margin-bottom: 1.5rem;">
			<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
				<div>
					<h1>File Buckets</h1>
					<p class="lead">Manage file storage buckets for the selected database</p>
				</div>
				<div style="display: flex; gap: 0.5rem;">
					<nui-select id="dbSelector" style="min-width: 200px;">
						<select>
							<option value="">Select a database...</option>
						</select>
					</nui-select>
				</div>
			</div>
		</header>

		<div id="bucketContent">
			<p style="color: var(--nui-text-muted);">Select a database to view buckets</p>
		</div>
	`;
	container.appendChild(page);

	const dbSelector = page.querySelector('#dbSelector');
	const bucketContent = page.querySelector('#bucketContent');

	// Populate database selector
	async function loadDbSelector() {
		try {
			const result = await ndbApi.list();
			const allDbs = result.databases || [];
			const loadedDbs = allDbs.filter(db => db.loaded);

			const select = dbSelector.querySelector('select');
			select.innerHTML = '<option value="">Select a database...</option>' +
				loadedDbs.map(db =>
					`<option value="${escapeHtml(db.handle)}" ${db.handle === currentHandle ? 'selected' : ''}>
						${escapeHtml(db.name)} (${db.docCount} docs)
					</option>`
				).join('');
		} catch (err) {
			nui.components.banner.show({
				content: 'Error loading databases: ' + err.message,
				priority: 'danger'
			});
		}
	}

	// Load buckets for the selected database
	async function loadBuckets() {
		if (!currentHandle) {
			bucketContent.innerHTML = '<p style="color: var(--nui-text-muted);">Select a database to view buckets</p>';
			return;
		}

		try {
			const result = await ndbApi.listBuckets(currentHandle);
			const buckets = result.buckets || [];

			if (buckets.length === 0) {
				bucketContent.innerHTML = `
					<nui-card>
						<div style="padding: 2rem; text-align: center;">
							<p style="color: var(--nui-text-muted);">No buckets found for this database.</p>
							<p style="font-size: 0.875rem; color: var(--nui-text-muted); margin-top: 0.5rem;">
								Buckets are created when files are stored via the nDB API.
							</p>
						</div>
					</nui-card>
				`;
				return;
			}

			let html = '<div style="display: flex; flex-direction: column; gap: 1rem;">';
			for (const bucket of buckets) {
				const sizeStr = formatBytes(bucket.totalSize || 0);
				const trashBadge = bucket.trashCount > 0
					? `<nui-badge variant="warning" title="${bucket.trashCount} files in trash">🗑 ${bucket.trashCount}</nui-badge>`
					: '';

				html += `
					<nui-card>
						<div style="padding: 1rem;">
							<div style="display: flex; justify-content: space-between; align-items: center;">
								<div>
									<strong style="font-size: 1.1rem;">📁 ${escapeHtml(bucket.name)}</strong>
									<div style="font-size: 0.875rem; color: var(--nui-text-muted); margin-top: 0.25rem;">
										${bucket.fileCount} file${bucket.fileCount !== 1 ? 's' : ''} · ${sizeStr}
									</div>
								</div>
								<div style="display: flex; gap: 0.5rem; align-items: center;">
									<nui-badge>${bucket.fileCount} files</nui-badge>
									${trashBadge}
								</div>
							</div>
							<div style="margin-top: 0.75rem; display: flex; gap: 0.5rem;">
								<nui-button class="view-files-btn" data-bucket="${escapeHtml(bucket.name)}">
									<button type="button">View Files</button>
								</nui-button>
								${bucket.trashCount > 0 ? `
									<nui-button class="view-bucket-trash-btn" data-bucket="${escapeHtml(bucket.name)}" variant="warning">
										<button type="button">View Trash</button>
									</nui-button>
								` : ''}
							</div>
						</div>
					</nui-card>
				`;
			}
			html += '</div>';
			bucketContent.innerHTML = html;

			// View files buttons
			bucketContent.querySelectorAll('.view-files-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					const bucket = btn.dataset.bucket;
					showBucketFiles(bucket);
				});
			});

			// View trash buttons
			bucketContent.querySelectorAll('.view-bucket-trash-btn').forEach(btn => {
				btn.addEventListener('click', () => {
					const bucket = btn.dataset.bucket;
					showBucketTrash(bucket);
				});
			});

		} catch (err) {
			bucketContent.innerHTML = `<p style="color: var(--nui-danger);">Error: ${escapeHtml(err.message)}</p>`;
		}
	}

	// Show files in a bucket
	async function showBucketFiles(bucketName) {
		try {
			const result = await ndbApi.listFiles(currentHandle, bucketName);
			const files = result.files || [];

			let html = `
				<div style="margin-bottom: 1rem;">
					<nui-button class="back-to-buckets-btn"><button type="button">← Back to Buckets</button></nui-button>
					<h3 style="margin-top: 0.5rem;">📁 ${escapeHtml(bucketName)} — ${files.length} file${files.length !== 1 ? 's' : ''}</h3>
				</div>
			`;

			if (files.length === 0) {
				html += '<p style="color: var(--nui-text-muted);">No files in this bucket.</p>';
			} else {
				html += '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
				for (const file of files) {
					const sizeStr = formatBytes(file.size || 0);
					html += `
						<div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; border: 1px solid var(--nui-border); border-radius: var(--nui-radius);">
							<div>
								<code>${escapeHtml(file.name || `${file.hash}.${file.ext}`)}</code>
								<div style="font-size: 0.75rem; color: var(--nui-text-muted);">${sizeStr} · ${escapeHtml(file.mimeType || 'unknown')}</div>
							</div>
							<nui-button class="delete-file-btn" data-bucket="${escapeHtml(bucketName)}" data-hash="${escapeHtml(file.hash)}" data-ext="${escapeHtml(file.ext)}" variant="danger" size="small">
								<button type="button">Delete</button>
							</nui-button>
						</div>
					`;
				}
				html += '</div>';
			}

			bucketContent.innerHTML = html;

			// Back button
			bucketContent.querySelector('.back-to-buckets-btn').addEventListener('click', loadBuckets);

			// Delete file buttons
			bucketContent.querySelectorAll('.delete-file-btn').forEach(btn => {
				btn.addEventListener('click', async () => {
					const bucket = btn.dataset.bucket;
					const hash = btn.dataset.hash;
					const ext = btn.dataset.ext;
					try {
						const confirmed = await nui.components.dialog.confirm(
							'Delete File',
							'This will move the file to trash. You can restore it later.'
						);
						if (confirmed) {
							await ndbApi.deleteFile(currentHandle, bucket, hash, ext);
							nui.components.banner.show({ content: 'File moved to trash', priority: 'success', autoClose: 2000 });
							showBucketFiles(bucketName);
						}
					} catch (err) {
						nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
					}
				});
			});

		} catch (err) {
			nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
		}
	}

	// Show trash for a bucket
	async function showBucketTrash(bucketName) {
		try {
			const result = await ndbApi.listBucketTrash(currentHandle, bucketName);
			const files = result.files || [];
			const count = result.count || 0;

			let html = `
				<div style="margin-bottom: 1rem;">
					<nui-button class="back-to-buckets-btn"><button type="button">← Back to Buckets</button></nui-button>
					<h3 style="margin-top: 0.5rem;">🗑️ Trash — ${escapeHtml(bucketName)} (${count} file${count !== 1 ? 's' : ''})</h3>
				</div>
				<div style="margin-bottom: 1rem;">
					<nui-button class="refresh-trash-btn" size="small"><button type="button">Refresh</button></nui-button>
					${count > 0 ? `
						<nui-button class="purge-trash-btn" variant="danger" size="small"><button type="button">Empty Trash</button></nui-button>
					` : ''}
				</div>
			`;

			if (files.length === 0) {
				html += '<p style="color: var(--nui-text-muted);">Trash is empty.</p>';
			} else {
				html += '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
				for (const file of files) {
					const sizeStr = formatBytes(file.size || 0);
					const deletedAt = file.deletedAt ? new Date(file.deletedAt).toLocaleString() : 'unknown';
					const fileName = `${file.hash}.${file.ext}`;
					html += `
						<div style="display: grid; grid-template-columns: 1fr auto auto; gap: 0.5rem; padding: 0.5rem; border: 1px solid var(--nui-border); border-radius: var(--nui-radius); align-items: center;">
							<div>
								<div><code>${escapeHtml(file.originalName || fileName)}</code></div>
								<div style="font-size: 0.75rem; color: var(--nui-text-muted);">
									${sizeStr} · ${escapeHtml(file.mimeType || 'unknown')} · deleted ${escapeHtml(deletedAt)}
								</div>
							</div>
							<nui-button class="restore-file-btn" data-bucket="${escapeHtml(bucketName)}" data-hash="${escapeHtml(file.hash)}" data-ext="${escapeHtml(file.ext)}" size="small" variant="success">
								<button type="button">Restore</button>
							</nui-button>
							<nui-button class="delete-trash-file-btn" data-bucket="${escapeHtml(bucketName)}" data-hash="${escapeHtml(file.hash)}" data-ext="${escapeHtml(file.ext)}" size="small" variant="danger">
								<button type="button">Delete</button>
							</nui-button>
						</div>
					`;
				}
				html += '</div>';
			}

			bucketContent.innerHTML = html;

			// Back button
			bucketContent.querySelector('.back-to-buckets-btn').addEventListener('click', loadBuckets);

			// Refresh button
			bucketContent.querySelector('.refresh-trash-btn').addEventListener('click', () => {
				showBucketTrash(bucketName);
			});

			// Purge button
			const purgeBtn = bucketContent.querySelector('.purge-trash-btn');
			if (purgeBtn) {
				purgeBtn.addEventListener('click', async () => {
					try {
						const confirmed = await nui.components.dialog.confirm(
							'Empty Trash',
							'This will permanently delete ALL files in the trash. This cannot be undone.'
						);
						if (confirmed) {
							const result = await ndbApi.purgeBucketTrash(currentHandle, bucketName);
							nui.components.banner.show({
								content: `Trash purged (${result.purged} files)`,
								priority: 'success',
								autoClose: 2000
							});
							showBucketTrash(bucketName);
						}
					} catch (err) {
						nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
					}
				});
			}

			// Restore buttons
			bucketContent.querySelectorAll('.restore-file-btn').forEach(btn => {
				btn.addEventListener('click', async () => {
					const bucket = btn.dataset.bucket;
					const hash = btn.dataset.hash;
					const ext = btn.dataset.ext;
					try {
						const result = await ndbApi.restoreBucketTrash(currentHandle, bucket, hash, ext);
						nui.components.banner.show({
							content: `Restored: ${result.restoredFile}`,
							priority: 'success',
							autoClose: 2000
						});
						showBucketTrash(bucketName);
					} catch (err) {
						nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
					}
				});
			});

			// Delete buttons
			bucketContent.querySelectorAll('.delete-trash-file-btn').forEach(btn => {
				btn.addEventListener('click', async () => {
					const bucket = btn.dataset.bucket;
					const hash = btn.dataset.hash;
					const ext = btn.dataset.ext;
					try {
						const confirmed = await nui.components.dialog.confirm(
							'Permanently Delete',
							'This will permanently delete this file. This cannot be undone.'
						);
						if (confirmed) {
							await ndbApi.deleteBucketTrash(currentHandle, bucket, hash, ext);
							nui.components.banner.show({
								content: 'File permanently deleted',
								priority: 'success',
								autoClose: 2000
							});
							showBucketTrash(bucketName);
						}
					} catch (err) {
						nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
					}
				});
			});

		} catch (err) {
			nui.components.banner.show({ content: `Error: ${err.message}`, priority: 'danger' });
		}
	}

	// Database selector change — nui-select dispatches 'nui-change' on the wrapper
	if (dbSelector) {
		dbSelector.addEventListener('nui-change', async (e) => {
			const select = dbSelector.querySelector('select');
			currentHandle = select ? select.value : e.detail?.value;
			store.setCurrentNdbHandle(currentHandle);
			await loadBuckets();
		});
	}

	// Initial load
	await loadDbSelector();
	await loadBuckets();
}

// ─── Utilities ────────────────────────────────────────────────────

function escapeHtml(str) {
	if (str == null) return '';
	return String(str)
		.replace(/&/g, '&')
		.replace(/</g, '<')
		.replace(/>/g, '>')
		.replace(/"/g, '"');
}

function formatBytes(bytes) {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

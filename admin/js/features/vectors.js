// admin/js/features/vectors.js — Vectors registered feature
// Vector database browser with search

import { nvdbApi } from '../api.js';
import { store } from '../store.js';

/**
 * Handle the Vectors feature page
 * @param {HTMLElement} container - The container element
 * @param {object} params - URL parameters
 * @param {object} nui - NUI library reference
 */
export async function handleVectorsPage(container, params, nui) {
	let currentHandle = params.handle || store.currentNvdbHandle;
	let collections = [];
	let selectedCollection = null;

	// Clear container
	container.innerHTML = '';

	// Create page layout
	const page = document.createElement('div');
	page.className = 'page-vectors';
	page.innerHTML = `
		<header style="margin-bottom: 1.5rem;">
			<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
				<div>
					<h1>Vector DBs</h1>
					<p class="lead">Manage nVDB vector database instances and collections</p>
				</div>
				<div style="display: flex; gap: 0.5rem;">
					<nui-select id="vdbSelector" style="min-width: 200px;">
						<select>
							<option value="">Select a vector DB...</option>
						</select>
					</nui-select>
					<nui-button data-action="open-vdb">
						<button type="button">+ Open</button>
					</nui-button>
				</div>
			</div>
		</header>

		<section id="collectionsSection" style="display: none;">
			<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
				<h2>Collections</h2>
				<nui-button data-action="create-collection">
					<button type="button">+ Create Collection</button>
				</nui-button>
			</div>
			<div id="collectionsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
				<!-- Collection cards will be inserted here -->
			</div>
		</section>

		<section id="searchSection" style="display: none; margin-bottom: 2rem; padding: 1rem; background: var(--nui-surface); border-radius: var(--nui-radius);">
			<h3 style="margin-top: 0;">Vector Search</h3>
			<div style="display: grid; gap: 1rem;">
				<div style="display: flex; gap: 1rem; flex-wrap: wrap;">
					<nui-select id="searchCollection" style="min-width: 150px;">
						<select>
							<option value="">Select collection...</option>
						</select>
					</nui-select>
					<nui-input-group style="flex: 1; min-width: 200px;">
						<label>Top K</label>
						<nui-input type="number" id="searchTopK" value="10" min="1" max="100"></nui-input>
					</nui-input-group>
					<nui-select id="searchDistance" style="min-width: 120px;">
						<select>
							<option value="cosine">Cosine</option>
							<option value="euclidean">Euclidean</option>
							<option value="dot">Dot Product</option>
						</select>
					</nui-select>
				</div>
				<nui-input-group>
					<label>Vector (comma-separated floats)</label>
					<nui-textarea id="searchVector" placeholder="0.1, 0.2, 0.3, ..." style="min-height: 80px; font-family: monospace;"></nui-textarea>
				</nui-input-group>
				<div style="display: flex; gap: 0.5rem;">
					<nui-button data-action="search-vectors" variant="primary">
						<button type="button">Search</button>
					</nui-button>
					<nui-button data-action="random-vector">
						<button type="button">Random Vector</button>
					</nui-button>
				</div>
			</div>
		</section>

		<section id="resultsSection" style="display: none;">
			<h3>Search Results</h3>
			<div id="searchResults" style="display: flex; flex-direction: column; gap: 0.5rem;">
				<!-- Results will be inserted here -->
			</div>
		</section>
	`;
	container.appendChild(page);

	const vdbSelector = page.querySelector('#vdbSelector');
	const collectionsSection = page.querySelector('#collectionsSection');
	const collectionsGrid = page.querySelector('#collectionsGrid');
	const searchSection = page.querySelector('#searchSection');
	const searchCollection = page.querySelector('#searchCollection');
	const resultsSection = page.querySelector('#resultsSection');
	const searchResults = page.querySelector('#searchResults');

	// Populate vector DB selector
	async function loadVdbSelector() {
		try {
			const result = await nvdbApi.list();
			const instances = result.instances || [];
			store.setNvdbInstances(instances);

			const select = vdbSelector.querySelector('select');
			select.innerHTML = '<option value="">Select a vector DB...</option>' +
				instances.map(vdb => 
					`<option value="${escapeHtml(vdb.handle)}" ${vdb.handle === currentHandle ? 'selected' : ''}>
						${escapeHtml(vdb.handle.substring(0, 8))}…
					</option>`
				).join('');
		} catch (err) {
			nui.components.banner.show({ 
				content: 'Error loading vector DBs: ' + err.message, 
				priority: 'danger' 
			});
		}
	}

	// Load collections for current handle
	async function loadCollections() {
		if (!currentHandle) {
			collectionsSection.style.display = 'none';
			searchSection.style.display = 'none';
			resultsSection.style.display = 'none';
			return;
		}

		try {
			store.setLoading('vectors', true);
			store.setCurrentNvdbHandle(currentHandle);

			const result = await nvdbApi.listCollections(currentHandle);
			collections = result.collections || [];

			// Render collection cards
			if (collections.length === 0) {
				collectionsGrid.innerHTML = '<p style="grid-column: 1/-1; color: var(--nui-text-muted);">No collections. Create one to get started.</p>';
			} else {
				collectionsGrid.innerHTML = collections.map(col => renderCollectionCard(col)).join('');
			}

			collectionsSection.style.display = '';
			searchSection.style.display = '';

			// Update search collection selector
			const searchSelect = searchCollection.querySelector('select');
			searchSelect.innerHTML = '<option value="">Select collection...</option>' +
				collections.map(col => 
					`<option value="${escapeHtml(col.name)}" ${col.name === selectedCollection ? 'selected' : ''}>
						${escapeHtml(col.name)} (dim: ${col.config.dim || '?'})
					</option>`
				).join('');

		} catch (err) {
			nui.components.banner.show({ 
				content: 'Error loading collections: ' + err.message, 
				priority: 'danger' 
			});
		} finally {
			store.setLoading('vectors', false);
		}
	}

	function renderCollectionCard(col) {
		const hasIndex = col.hasIndex ? 'Yes' : 'No';
		const indexVariant = col.hasIndex ? 'success' : 'default';
		
		return `
			<nui-card data-collection="${escapeHtml(col.name)}" style="cursor: pointer;">
				<div slot="header">
					<div style="display: flex; justify-content: space-between; align-items: center;">
						<strong>${escapeHtml(col.name)}</strong>
						<nui-badge variant="${indexVariant}">Index: ${hasIndex}</nui-badge>
					</div>
				</div>
				<div style="font-size: 0.875rem; color: var(--nui-text-muted);">
					<div>Dimension: ${col.config.dim || '?'}</div>
					<div>Durability: ${col.config.durability || 'default'}</div>
					<div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--nui-border);">
						<div>Documents: ${formatNumber(col.stats.totalSegmentDocs || 0)}</div>
						<div>Memtable: ${formatNumber(col.stats.memtableDocs || 0)}</div>
						<div>Segments: ${col.stats.segmentCount || 0}</div>
					</div>
				</div>
				<div slot="footer" style="display: flex; gap: 0.5rem;">
					<nui-button data-action="flush-collection" data-name="${escapeHtml(col.name)}" size="small">
						<button type="button">Flush</button>
					</nui-button>
					<nui-button data-action="compact-collection" data-name="${escapeHtml(col.name)}" size="small">
						<button type="button">Compact</button>
					</nui-button>
				</div>
			</nui-card>
		`;
	}

	// Handle actions
	page.addEventListener('click', async (e) => {
		const actionEl = e.target.closest('[data-action]');
		if (!actionEl) return;

		const action = actionEl.dataset.action;
		const collectionName = actionEl.dataset.name;

		switch (action) {
			case 'open-vdb': {
				const result = await nui.components.dialog.prompt('Open Vector DB', 'Enter the database path:', {
					fields: [{ id: 'path', label: 'Path', value: '' }]
				});
				if (result && result.path) {
					try {
						await nvdbApi.open(result.path);
						nui.components.banner.show({ 
							content: `Opened: ${result.path}`, 
							priority: 'success', 
							autoClose: 3000 
						});
						await loadVdbSelector();
					} catch (err) {
						nui.components.banner.show({ 
							content: 'Error: ' + err.message, 
							priority: 'danger' 
						});
					}
				}
				break;
			}

			case 'create-collection': {
				if (!currentHandle) return;
				const result = await nui.components.dialog.prompt('Create Collection', 'Enter collection details:', {
					fields: [
						{ id: 'name', label: 'Name', value: '' },
						{ id: 'dimension', label: 'Dimension', value: '768' },
					]
				});
				if (result && result.name && result.dimension) {
					try {
						const dim = parseInt(result.dimension, 10);
						await nvdbApi.createCollection(currentHandle, result.name, dim);
						nui.components.banner.show({ 
							content: `Collection created: ${result.name}`, 
							priority: 'success', 
							autoClose: 3000 
						});
						await loadCollections();
					} catch (err) {
						nui.components.banner.show({ 
							content: 'Error: ' + err.message, 
							priority: 'danger' 
						});
					}
				}
				break;
			}

			case 'flush-collection': {
				if (!collectionName) return;
				try {
					await nvdbApi.flush(currentHandle, collectionName);
					nui.components.banner.show({ 
						content: `Flushed: ${collectionName}`, 
						priority: 'success', 
						autoClose: 2000 
					});
					await loadCollections();
				} catch (err) {
					nui.components.banner.show({ 
						content: 'Error: ' + err.message, 
						priority: 'danger' 
					});
				}
				break;
			}

			case 'compact-collection': {
				if (!collectionName) return;
				try {
					await nvdbApi.compact(currentHandle, collectionName);
					nui.components.banner.show({ 
						content: `Compacted: ${collectionName}`, 
						priority: 'success', 
						autoClose: 2000 
					});
					await loadCollections();
				} catch (err) {
					nui.components.banner.show({ 
						content: 'Error: ' + err.message, 
						priority: 'danger' 
					});
				}
				break;
			}

			case 'search-vectors': {
				await performSearch();
				break;
			}

			case 'random-vector': {
				const colSelect = searchCollection.querySelector('select');
				const selectedCol = colSelect.value;
				if (!selectedCol) {
					nui.components.banner.show({ 
						content: 'Please select a collection first', 
						priority: 'warning' 
					});
					return;
				}
				
				// Find collection dimension
				const col = collections.find(c => c.name === selectedCol);
				const dim = col?.config?.dim || 128;
				
				// Generate random vector
				const randomVec = Array.from({ length: dim }, () => (Math.random() * 2 - 1).toFixed(6));
				page.querySelector('#searchVector').value = randomVec.join(', ');
				break;
			}
		}
	});

	// VDB selector change — nui-select dispatches 'nui-change' on the wrapper
	if (vdbSelector) {
		vdbSelector.addEventListener('nui-change', async (e) => {
			const select = vdbSelector.querySelector('select');
			currentHandle = select ? select.value : e.detail?.value;
			selectedCollection = null;
			await loadCollections();

			if (currentHandle) {
				window.history.replaceState(null, '', `#feature=vectors&handle=${currentHandle}`);
			}
		});
	}

	// Collection card click
	collectionsGrid.addEventListener('click', (e) => {
		const card = e.target.closest('[data-collection]');
		if (!card) return;
		
		const colName = card.dataset.collection;
		const select = searchCollection.querySelector('select');
		select.value = colName;
		selectedCollection = colName;
		
		// Scroll to search section
		searchSection.scrollIntoView({ behavior: 'smooth' });
	});

	async function performSearch() {
		const colSelect = searchCollection.querySelector('select');
		const collectionName = colSelect.value;
		
		if (!collectionName) {
			nui.components.banner.show({ 
				content: 'Please select a collection', 
				priority: 'warning' 
			});
			return;
		}
		
		const vectorText = page.querySelector('#searchVector').value.trim();
		if (!vectorText) {
			nui.components.banner.show({ 
				content: 'Please enter a vector', 
				priority: 'warning' 
			});
			return;
		}
		
		let vector;
		try {
			vector = vectorText.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
		} catch {
			nui.components.banner.show({ 
				content: 'Invalid vector format', 
				priority: 'danger' 
			});
			return;
		}
		
		const topK = parseInt(page.querySelector('#searchTopK').value, 10) || 10;
		const distance = page.querySelector('#searchDistance').value;
		
		try {
			resultsSection.style.display = '';
			searchResults.innerHTML = '<nui-progress indeterminate>Searching...</nui-progress>';
			
			const result = await nvdbApi.search(currentHandle, collectionName, vector, topK, distance);
			const results = result.results || [];
			
			if (results.length === 0) {
				searchResults.innerHTML = '<p style="color: var(--nui-text-muted);">No results found</p>';
			} else {
				searchResults.innerHTML = results.map((r, i) => `
					<div style="display: flex; gap: 1rem; align-items: center; padding: 0.75rem; background: var(--nui-surface); border-radius: var(--nui-radius);">
						<nui-badge variant="${i < 3 ? 'success' : 'default'}">#${i + 1}</nui-badge>
						<div style="flex: 1; min-width: 0;">
							<div style="font-family: monospace; font-size: 0.875rem;">${escapeHtml(r.id)}</div>
							<div style="font-size: 0.75rem; color: var(--nui-text-muted);">
								${r.payload ? escapeHtml(JSON.stringify(r.payload).substring(0, 100)) : 'No payload'}
							</div>
						</div>
						<nui-badge variant="info">Score: ${r.score.toFixed(4)}</nui-badge>
					</div>
				`).join('');
			}
		} catch (err) {
			searchResults.innerHTML = `<p style="color: var(--nui-danger);">Search error: ${escapeHtml(err.message)}</p>`;
		}
	}

	// Initial load
	await loadVdbSelector();
	await loadCollections();

	// Return cleanup function
	return () => {
		// Cleanup if needed
	};
}

// ─── Utilities ────────────────────────────────────────────────────

function escapeHtml(str) {
	if (str == null) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function formatNumber(num) {
	if (num == null) return '0';
	return num.toLocaleString();
}

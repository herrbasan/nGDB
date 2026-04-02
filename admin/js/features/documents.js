// admin/js/features/documents.js
import { ndbApi } from '../api.js';
import { store } from '../store.js';
import { nui } from '../../NUI/NUI/nui.js';

function getFieldByPath(obj, path) {
    if (!path || !obj) return null;
    const parts = path.split('.');
    let val = obj;
    for (const p of parts) {
        if (val == null || typeof val !== 'object') return null;
        val = val[p];
    }
    return val;
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function handleDocumentsPage(container, params) {
    let handle = params && params.handle;
    if (!handle && window.location.hash) {
        handle = new URLSearchParams(window.location.hash.substring(1)).get('handle');
    }
    
    container.innerHTML = '';
    
    if (!handle) {
        container.innerHTML = '<div style="padding: 2rem;">Please select a database from the sidebar.</div>';
        return;
    }

    if (!store.ndbInstances || store.ndbInstances.length === 0) {
        try {
            const res = await ndbApi.list();
            store.setNdbInstances(res.databases || []);
        } catch(err) {
            nui.components.banner.show({ content: 'Error fetching databases: ' + err.message, priority: 'danger' });
            return;
        }
    }

    const currentDb = (store.ndbInstances || []).find(d => d.handle === handle);
    if (!currentDb) {
        container.innerHTML = '<div style="padding: 2rem;">Database not found or not loaded.</div>';
        return;
    }

    const metaSettings = currentDb.meta?.display || {};
    const titleField = metaSettings.title;
    const contentField = metaSettings.content;
    const iconField = metaSettings.icon;

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 100vh; box-sizing: border-box;">
            <header style="padding: 1rem; border-bottom: 1px solid var(--nui-border-light); display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <h1 style="margin: 0; font-size: 1.25rem;">${escapeHtml(currentDb.name)}</h1>
                    <p style="margin: 0; font-size: 0.85rem; color: var(--nui-muted); margin-top: 0.25rem;">Document Browser</p>
                </div>
            </header>
            <div style="flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column;">
                <nui-list id="nuiDocList" style="flex: 1; height: 100%;"></nui-list>
            </div>
        </div>
    `;

    const listEl = container.querySelector('#nuiDocList');

    try {
        nui.components.banner.show({ content: 'Loading documents...', priority: 'info', autoClose: 1000 });
        const result = await ndbApi.listDocs(handle, { limit: 1000 }); 
        const docs = result.docs || [];

        const sortConfig = [];
        const searchConfig = [{ prop: '_id' }];

        if (titleField && titleField !== '_id') {
            sortConfig.push({ label: 'Title', prop: titleField, direction_default: 'up' });
            searchConfig.push({ prop: titleField });
        }
        
        sortConfig.push({ label: 'ID', prop: '_id' });
        sortConfig.push({ label: 'Created (New)', prop: '_created', numeric: true, dir: 'desc' });
        sortConfig.push({ label: 'Created (Old)', prop: '_created', numeric: true, dir: 'asc' });
        sortConfig.push({ label: 'Modified', prop: '_modified', numeric: true });
        
        if (contentField) {
            searchConfig.push({ prop: contentField });
        }

        await customElements.whenDefined('nui-list');
        
        if (listEl.loadData) {
            listEl.loadData({
                data: docs,
                search: searchConfig,
                sort: sortConfig,
                sort_default: 0,
                render: doc => {
                    const el = document.createElement('div');
                    el.className = 'db-card';
                    el.style.cssText = 'display: grid; padding: 0.75rem; align-items: center; border-bottom: 1px solid var(--nui-border-light); grid-template-columns: auto 1fr auto; gap: 0.75rem; width: 100%; box-sizing: border-box;';

                    const id = doc._id || 'no-id';

                    let titleHtml = `<nui-badge variant="info" style="font-size: 0.75rem;">${escapeHtml(id)}</nui-badge>`;
                    if (titleField && titleField !== '_id') {
                        const titleVal = getFieldByPath(doc, titleField);
                        if (titleVal != null) {
                            titleHtml = `<strong style="font-size: 0.95rem;">${escapeHtml(String(titleVal))}</strong>`;
                        }
                    }

                    let contentHtml = '';
                    if (contentField) {
                        const contentVal = getFieldByPath(doc, contentField);
                        if (contentVal != null) {
                            contentHtml = `<div class="text-truncate text-small" style="color: var(--nui-muted);">${escapeHtml(String(contentVal))}</div>`;
                        }
                    }

                    if (!contentHtml) {
                        const previewObj = { ...doc };
                        delete previewObj._id;
                        delete previewObj._created;
                        delete previewObj._modified;
                        delete previewObj._deleted;
                        const keys = Object.keys(previewObj);
                        const preview = keys.length > 0 ? JSON.stringify(previewObj).substring(0, 100) : '(empty document)';
                        contentHtml = `<code class="text-truncate text-small" style="color: var(--nui-muted);">${escapeHtml(preview)}</code>`;
                    }

                    let iconHtml = '';
                    if (iconField) {
                        const iconVal = getFieldByPath(doc, iconField);
                        if (iconVal != null) {
                            iconHtml = `<div style="font-size: 2rem; width: 3rem; text-align: center; margin-right: 0.5rem; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">${escapeHtml(String(iconVal))}</div>`;
                            el.style.gridTemplateColumns = 'auto auto 1fr auto';
                        }
                    }

                    const datesHtml = `
                        <div style="font-size: 0.65rem; color: var(--nui-muted); margin-top: 0.25rem;">
                            C: ${new Date(doc._created).toLocaleString()}<br/>
                            M: ${new Date(doc._modified).toLocaleString()}
                        </div>
                    `;

                    el.innerHTML = `
                        ${iconHtml}
                        <div style="display: flex; flex-direction: column; min-width:0; overflow: hidden; gap: 0.15rem;">
                            <div>${titleHtml}</div>
                            ${titleField && titleField !== '_id' ? `<div style="font-size: 0.7rem; font-family: monospace; color: var(--nui-muted);">${escapeHtml(id)}</div>` : ''}
                        </div>
                        <div style="min-width: 0; display: flex; flex-direction: column; justify-content: center; overflow: hidden; padding-right: 1rem;">
                            ${contentHtml}
                            ${datesHtml}
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <nui-button data-action="view-doc" data-id="${escapeHtml(id)}" size="small"><button>View</button></nui-button>
                            <nui-button data-action="delete-doc" data-id="${escapeHtml(id)}" size="small" variant="danger"><button>Delete</button></nui-button>
                        </div>
                    `;
                    return el;
                }
            });
        } else {
            console.error('nui-list loadData method is missing after whenDefined!', listEl);
        }
    } catch (err) {
        nui.components.banner.show({ content: 'Failed to load docs: ' + err.message, priority: 'danger' });
    }

    listEl.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const docId = btn.dataset.id;
        
        switch (action) {
            case 'view-doc':
                alert('View functionality placeholder for id: ' + docId);
                break;
            case 'delete-doc':
                const confirmed = await nui.components.dialog.confirm('Delete Document', 'Are you sure you want to delete ' + docId + '?');
                if (confirmed) {
                    try {
                        await ndbApi.deleteDoc(handle, docId);
                        nui.components.banner.show({ content: 'Deleted ' + docId, priority: 'success' });
                        handleDocumentsPage(container, params);
                    } catch (e) {
                         nui.components.banner.show({ content: e.message, priority: 'danger' });
                    }
                }
                break;
        }
    });
}

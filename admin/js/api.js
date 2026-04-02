// admin/js/api.js — Shared API client for nGDB Admin
// Wraps all /admin/api/* endpoints

const API_BASE = '../admin/api';

/**
 * Make an API request to the admin backend
 * @param {string} path - API path (without /admin/api prefix)
 * @param {object} options - Fetch options
 * @returns {Promise<any>} - Parsed JSON response
 */
async function api(path, options = {}) {
	const isFormData = options.body instanceof FormData;
	const headers = isFormData 
		? { ...options.headers }
		: { 'Content-Type': 'application/json', ...options.headers };
	
	const res = await fetch(`${API_BASE}${path}`, {
		...options,
		headers,
	});
	
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(err.error || `HTTP ${res.status}`);
	}
	
	// Some endpoints might return empty body (e.g., 204 No Content)
	if (res.status === 204) {
		return null;
	}
	
	return res.json();
}

// ─── Status API ───────────────────────────────────────────────────

export const statusApi = {
	get: () => api('/status'),
};

// ─── nDB API ───────────────────────────────────────────────────────

export const ndbApi = {
	// Instances — list ALL databases (loaded + unloaded)
	list: () => api('/ndb'),
	// Available — list only unloaded databases
	listAvailable: () => api('/ndb/available'),
	// Open a database by path (manual)
	open: (path, options) => api('/ndb/open', { 
		method: 'POST', 
		body: JSON.stringify({ path, options }) 
	}),
	// Load a discovered database by path
	load: (path, options) => api('/ndb/load', { 
		method: 'POST', 
		body: JSON.stringify({ path, options }) 
	}),
	// Unload a loaded database (flush + close)
	unload: (handle) => api(`/ndb/${handle}/unload`, { method: 'POST' }),
	// Close a database (legacy, same as unload)
	close: (handle) => api(`/ndb/${handle}`, { method: 'DELETE' }),
	
	// Documents
	listDocs: (handle, { limit, offset } = {}) => {
		const params = new URLSearchParams();
		if (limit !== undefined) params.append('limit', limit);
		if (offset !== undefined) params.append('offset', offset);
		const query = params.toString() ? `?${params.toString()}` : '';
		return api(`/ndb/${handle}/docs${query}`);
	},
	getDoc: (handle, id) => api(`/ndb/${handle}/docs/${id}`),
	insertDoc: (handle, doc) => api(`/ndb/${handle}/docs`, { 
		method: 'POST', 
		body: JSON.stringify({ doc }) 
	}),
	updateDoc: (handle, id, doc) => api(`/ndb/${handle}/docs/${id}`, { 
		method: 'PUT', 
		body: JSON.stringify({ doc }) 
	}),
	deleteDoc: (handle, id) => api(`/ndb/${handle}/docs/${id}`, { method: 'DELETE' }),
	
	// Query
	query: (handle, ast, options) => api(`/ndb/${handle}/query`, { 
		method: 'POST', 
		body: JSON.stringify({ ast, options }) 
	}),
	
	// Indexes
	listIndexes: (handle) => api(`/ndb/${handle}/indexes`),
	
	// Maintenance
	flush: (handle) => api(`/ndb/${handle}/flush`, { method: 'POST' }),
	compact: (handle) => api(`/ndb/${handle}/compact`, { method: 'POST' }),
	
	// Document Trash
	listTrash: (handle) => api(`/ndb/${handle}/trash`),
	restoreTrash: (handle, id) => api(`/ndb/${handle}/trash/${id}/restore`, { method: 'POST' }),
	deleteTrash: (handle, id) => api(`/ndb/${handle}/trash/${id}`, { method: 'DELETE' }),
	purgeTrash: (handle) => api(`/ndb/${handle}/trash`, { method: 'DELETE' }),
	
	// Buckets
	listBuckets: (handle) => api(`/ndb/${handle}/buckets`),
	listFiles: (handle, bucket) => api(`/ndb/${handle}/buckets/${bucket}/files`),
	storeFile: (handle, bucket, name, data, mimeType) => {
		// Binary file upload - using base64 for now
		const base64Data = data; // Assume already base64
		return api(`/ndb/${handle}/buckets/${bucket}/files`, {
			method: 'POST',
			body: JSON.stringify({ name, data: base64Data, mimeType }),
		});
	},
	deleteFile: (handle, bucket, hash, ext) => 
		api(`/ndb/${handle}/buckets/${bucket}/files/${hash}/${ext}`, { method: 'DELETE' }),
	
	// Bucket File Trash
	listBucketTrash: (handle, bucket) => api(`/ndb/${handle}/buckets/${bucket}/trash`),
	restoreBucketTrash: (handle, bucket, hash, ext) => 
		api(`/ndb/${handle}/buckets/${bucket}/trash/${hash}/${ext}/restore`, { method: 'POST' }),
	deleteBucketTrash: (handle, bucket, hash, ext) => 
		api(`/ndb/${handle}/buckets/${bucket}/trash/${hash}/${ext}`, { method: 'DELETE' }),
	purgeBucketTrash: (handle, bucket) => 
		api(`/ndb/${handle}/buckets/${bucket}/trash`, { method: 'DELETE' }),
};

// ─── nVDB API ──────────────────────────────────────────────────────

export const nvdbApi = {
	// Instances
	list: () => api('/nvdb'),
	open: (path) => api('/nvdb/open', { method: 'POST', body: JSON.stringify({ path }) }),
	close: (handle) => api(`/nvdb/${handle}`, { method: 'DELETE' }),
	
	// Collections
	listCollections: (handle) => api(`/nvdb/${handle}/collections`),
	createCollection: (handle, name, dimension, options) => 
		api(`/nvdb/${handle}/collections`, { 
			method: 'POST', 
			body: JSON.stringify({ name, dimension, options }) 
		}),
	getCollection: (handle, name) => api(`/nvdb/${handle}/collections/${name}`),
	
	// Search
	search: (handle, name, vector, topK, distance) => 
		api(`/nvdb/${handle}/collections/${name}/search`, {
			method: 'POST',
			body: JSON.stringify({ vector, topK, distance }),
		}),
	
	// Maintenance
	flush: (handle, name) => api(`/nvdb/${handle}/collections/${name}/flush`, { method: 'POST' }),
	compact: (handle, name) => api(`/nvdb/${handle}/collections/${name}/compact`, { method: 'POST' }),
};

// Default export for backward compatibility
export { api };

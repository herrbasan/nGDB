// admin/js/store.js — Centralized app state for nGDB Admin
// Shared state across all registered features

/**
 * Centralized application state store
 * Features subscribe to changes and call notify() on mutations
 */
export const store = {
	// Open database instances
	ndbInstances: [],      // [{ handle, path, docCount }]
	nvdbInstances: [],     // [{ handle }]

	// Current selections
	currentNdbHandle: null,
	currentNvdbHandle: null,
	currentCollection: null,

	// Edit state
	editingDoc: null,      // { handle, id, doc } — null when dialog closed
	editingVector: null,   // { handle, collection, id } — null when dialog closed

	// Loading states
	loading: {
		databases: false,
		documents: false,
		vectors: false,
	},

	// Error states
	errors: {},

	// Listeners for reactive updates
	listeners: new Set(),

	/**
	 * Subscribe to store changes
	 * @param {function} fn - Callback function(store)
	 * @returns {function} - Unsubscribe function
	 */
	subscribe(fn) {
		this.listeners.add(fn);
		// Return unsubscribe function
		return () => this.listeners.delete(fn);
	},

	/**
	 * Notify all subscribers of state change
	 */
	notify() {
		this.listeners.forEach(fn => {
			try {
				fn(this);
			} catch (err) {
				console.error('Store subscriber error:', err);
			}
		});
	},

	/**
	 * Update nDB instances and notify
	 * @param {Array} instances 
	 */
	setNdbInstances(instances) {
		this.ndbInstances = instances;
		this.notify();
	},

	/**
	 * Update nVDB instances and notify
	 * @param {Array} instances 
	 */
	setNvdbInstances(instances) {
		this.nvdbInstances = instances;
		this.notify();
	},

	/**
	 * Set current nDB handle and notify
	 * @param {string|null} handle 
	 */
	setCurrentNdbHandle(handle) {
		this.currentNdbHandle = handle;
		this.notify();
	},

	/**
	 * Set current nVDB handle and notify
	 * @param {string|null} handle 
	 */
	setCurrentNvdbHandle(handle) {
		this.currentNvdbHandle = handle;
		this.notify();
	},

	/**
	 * Set current collection and notify
	 * @param {string|null} collection 
	 */
	setCurrentCollection(collection) {
		this.currentCollection = collection;
		this.notify();
	},

	/**
	 * Set loading state and notify
	 * @param {string} key 
	 * @param {boolean} value 
	 */
	setLoading(key, value) {
		this.loading[key] = value;
		this.notify();
	},

	/**
	 * Set error state and notify
	 * @param {string} key 
	 * @param {Error|null} error 
	 */
	setError(key, error) {
		if (error) {
			this.errors[key] = error;
		} else {
			delete this.errors[key];
		}
		this.notify();
	},

	/**
	 * Get an nDB instance by handle
	 * @param {string} handle 
	 * @returns {object|undefined}
	 */
	getNdbInstance(handle) {
		return this.ndbInstances.find(i => i.handle === handle);
	},

	/**
	 * Get an nVDB instance by handle
	 * @param {string} handle 
	 * @returns {object|undefined}
	 */
	getNvdbInstance(handle) {
		return this.nvdbInstances.find(i => i.handle === handle);
	},
};

// Make store available globally for debugging
if (typeof window !== 'undefined') {
	window.ngdbStore = store;
}

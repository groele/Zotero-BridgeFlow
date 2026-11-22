var Zotero;
var startupGeneration = 0;
var activeRootURI = null;

var LEGACY_CONFLICT_ADDON_IDS = [
	'zotero-tabflow@groele',
	'zotero-viewflow@groele',
	'citeflow@groele',
	'zoterocitation@polygon.org',
];

async function disableLegacyConflictAddons() {
	if (typeof ChromeUtils === 'undefined' || !ChromeUtils.importESModule) return;
	let AddonManager;
	try {
		({ AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'));
	} catch {
		return;
	}
	for (const legacyID of LEGACY_CONFLICT_ADDON_IDS) {
		try {
			const addon = await AddonManager.getAddonByID(legacyID);
			if (addon?.isActive) {
				Zotero?.debug?.(`Zotero BridgeFlow: disabling legacy conflicting add-on ${legacyID}`);
				await addon.disable();
			}
		} catch (error) {
			Zotero?.logError?.(error);
		}
	}
}

async function startup({ id, version, rootURI }) {
	const generation = ++startupGeneration;
	await Zotero.initializationPromise;
	if (generation !== startupGeneration) return;
	try {
		await disableLegacyConflictAddons();
		if (generation !== startupGeneration) return;

		activeRootURI = rootURI;
		Services.scriptloader.loadSubScript(rootURI + 'zoterobridgeflow.js');
		const bridgeflow = Zotero.zoterobridgeflow;
		bridgeflow.init({ id, version, rootURI });
		if (Zotero.ftl?.addResourceIds) {
			Zotero.ftl.addResourceIds(['zotero-bridgeflow.ftl']);
			bridgeflow._ftlRegistered = true;
		}
		Zotero.PreferencePanes.register({
			pluginID: id,
			src: rootURI + 'prefs.xhtml',
			scripts: [rootURI + 'zoterobridgeflow_prefs.js'],
			stylesheets: [rootURI + 'settings.css'],
			defaultXUL: true,
		});
		await bridgeflow.start();
	} catch (error) {
		shutdown();
		throw error;
	}
}

function shutdown(_data, reason) {
	startupGeneration++;
	const bridgeflow = Zotero?.zoterobridgeflow;
	try {
		bridgeflow?.shutdown();
	} catch (error) {
		Zotero?.logError?.(error);
	} finally {
		try {
			if (bridgeflow?._ftlRegistered) {
				Zotero.ftl?.removeResourceIds?.(['zotero-bridgeflow.ftl']);
			}
		} catch (error) {
			Zotero?.logError?.(error);
		} finally {
			if (Zotero) delete Zotero.zoterobridgeflow;
			const appShutdown = typeof APP_SHUTDOWN !== 'undefined' && reason === APP_SHUTDOWN;
			if (!appShutdown) {
				try {
					if (activeRootURI && typeof Cu !== 'undefined') Cu.unload(activeRootURI + 'zoteropreview.js');
				} catch { /* ignore */ }
				try {
					if (activeRootURI && typeof Cu !== 'undefined') Cu.unload(activeRootURI + 'zoterobridgeflow.js');
				} catch (error) {
					Zotero?.logError?.(error);
				}
				try {
					if (typeof Cc !== 'undefined' && typeof Ci !== 'undefined') {
						Cc['@mozilla.org/intl/stringbundle;1'].getService(Ci.nsIStringBundleService).flushBundles();
					}
				} catch (error) {
					Zotero?.logError?.(error);
				}
				try {
					if (typeof ADDON_DISABLE !== 'undefined' && reason === ADDON_DISABLE) {
						Services.obs.notifyObservers(null, 'startupcache-invalidate', null);
					}
				} catch (error) {
					Zotero?.logError?.(error);
				}
			}
			activeRootURI = null;
		}
	}
}

function onMainWindowLoad({ window }) {
	Zotero?.zoterobridgeflow?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
	Zotero?.zoterobridgeflow?.onMainWindowUnload(window);
}

function install() {}
function uninstall() {}

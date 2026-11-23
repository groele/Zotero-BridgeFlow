var Zotero;
var startupGeneration = 0;
var activeRootURI = null;

async function startup({ id, version, rootURI }) {
	const generation = ++startupGeneration;
	await Promise.all([
		Zotero.initializationPromise,
		Zotero.unlockPromise,
		Zotero.uiReadyPromise,
	].filter(Boolean));
	if (generation !== startupGeneration) return;
	try {

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

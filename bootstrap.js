var Zotero;
var startupGeneration = 0;
var activeRootURI = null;
var activePrefPaneID = null;

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
		const panePromise = Zotero.PreferencePanes.register({
			pluginID: id,
			src: rootURI + 'prefs.xhtml',
			scripts: [rootURI + 'zoterobridgeflow_prefs.js'],
			stylesheets: [rootURI + 'settings.css'],
			defaultXUL: true,
		});
		Promise.resolve(panePromise).then((paneID) => {
			if (generation === startupGeneration && paneID) activePrefPaneID = paneID;
			else if (paneID) Zotero.PreferencePanes?.unregister?.(paneID);
		}).catch(() => {});
		await bridgeflow.start();
	} catch (error) {
		if (generation === startupGeneration) shutdown();
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
					if (activePrefPaneID) Zotero?.PreferencePanes?.unregister?.(activePrefPaneID);
				} catch (error) {
					Zotero?.logError?.(error);
				}
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
			activePrefPaneID = null;
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

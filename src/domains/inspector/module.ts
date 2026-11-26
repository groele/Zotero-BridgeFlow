import { DisposableStack } from '../../kernel/disposable.ts';
import type { PluginKernel } from '../../kernel/plugin-kernel.ts';
import type { DomainModule } from '../../kernel/types.ts';
import type { ServiceContainer } from '../../services/service-container.ts';
import { CitationLookupEngine, type LookupCandidate } from './lookup/citation-lookup-engine.ts';
import { CitationLookupSectionController } from './lookup/citation-lookup-section.ts';
import { CslPreviewSectionController } from './csl-preview/csl-preview-section.ts';
import { PdfFolderSectionController } from './pdf/pdf-folder-section.ts';
import { PdfPreviewSectionController } from './pdf/pdf-preview-section.ts';
import { WordCiteSectionController } from './word-panel/word-cite-section.ts';

import { clearReminderFieldsCache } from './word-panel/word-cite-reminders-model.ts';

export class InspectorDomainModule implements DomainModule {
	public readonly id = 'inspector' as const;
	public readonly enabledPref = 'modules.inspector.enable';
	public readonly lookupEngine: CitationLookupEngine;

	private readonly cslPreview: CslPreviewSectionController;
	private readonly lookupSection: CitationLookupSectionController;
	private readonly pdfPreview: PdfPreviewSectionController;
	private readonly pdfFolder: PdfFolderSectionController;
	private readonly wordCiteSection: WordCiteSectionController;
	private readonly disposables = new DisposableStack();
	private active = false;

	private readonly kernel: PluginKernel;
	private readonly services: ServiceContainer;

	constructor(kernel: PluginKernel, services: ServiceContainer) {
		this.kernel = kernel;
		this.services = services;
		this.lookupEngine = new CitationLookupEngine(services.history);
		this.cslPreview = new CslPreviewSectionController(kernel, services);
		this.lookupSection = new CitationLookupSectionController(kernel, services, this.lookupEngine);
		this.pdfPreview = new PdfPreviewSectionController(kernel, services);
		this.pdfFolder = new PdfFolderSectionController(kernel, services);
		this.wordCiteSection = new WordCiteSectionController(kernel, services);
	}

	isActive(): boolean {
		return this.active;
	}

	start(): void {
		if (this.active) return;
		this.active = true;
		this.disposables.reset();
		this.syncSections();

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				[
					'inspector.cslPreview.enable',
					'inspector.lookup.enable',
					'inspector.pdfPreview.enable',
					'inspector.pdfFolder.enable',
					'inspector.wordCite.enable',
					'modules.wordCite.enable',
				],
				() => this.syncSections(),
			),
		);

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				[
					'inspector.wordCite.showDocSwitcher',
					'inspector.wordCite.showSummaryCounts',
					'inspector.wordCite.showGroupSynergy',
					'inspector.wordCite.showCollectionLink',
					'inspector.wordCite.showOrphanRecovery',
					'inspector.wordCite.orphanAutoExpand',
					'inspector.wordCite.showMetadataReminders',
					'inspector.wordCite.reminderScope',
					'inspector.wordCite.reminderAutoExpand',
					'inspector.wordCite.reminderCheckCreatorsYear',
					'inspector.wordCite.reminderCheckVenue',
					'inspector.wordCite.reminderCheckPagination',
					'inspector.wordCite.reminderShowSuggested',
					'inspector.wordCite.reminderStrictOnlineFirst',
					'wordCite.collections.enable',
					'wordCite.citationTags.text',
				],
				() => this.wordCiteSection.refreshAll(),
			),
		);

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				[
					'inspector.cslPreview.position',
					'inspector.pdfPreview.position',
					'inspector.pdfFolder.position',
					'inspector.wordCite.position',
				],
				() => this.services.panePositions.queueAll(),
			),
		);

		this.disposables.add(
			this.kernel.prefs.observeKeys(
				[
					'inspector.cslPreview.citationstyle',
					'inspector.cslPreview.whatToShow',
					'inspector.cslPreview.fontsize',
					'inspector.cslPreview.spacing',
					'inspector.cslPreview.maxPreviewItems',
				],
				() => { void this.cslPreview.refreshAll(); },
			),
		);

		this.disposables.add(
			this.kernel.bus.on('inspector:clear-cache', () => { this.lookupEngine.clearCache(); clearReminderFieldsCache(); }),
		);

		this.disposables.add(
			this.kernel.notifier.subscribe(['item'], ({ event, ids }) => {
				if (!this.active) return;
				const itemIDs = ids.map(Number).filter((n) => Number.isFinite(n) && n > 0);
				if (event === 'restore' || event === 'add' || event === 'trash' || event === 'delete') {
					this.lookupEngine.clearCache();
					return;
				}
				if (event !== 'modify') return;
				void this.cslPreview.refreshModifiedItems(itemIDs);
			}),
		);
	}

	async lookupQuery(query: string, libraryItems?: readonly any[]): Promise<LookupCandidate[]> {
		return this.lookupEngine.lookup(query, libraryItems);
	}

	async refreshAllPreviews(): Promise<void> {
		await this.cslPreview.refreshAll();
		this.wordCiteSection.refreshAll();
	}

	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.lookupEngine.clearCache();
		clearReminderFieldsCache();
		this.cslPreview.unregister();
		this.lookupSection.unregister();
		this.pdfPreview.unregister();
		this.pdfFolder.unregister();
		this.wordCiteSection.unregister();
		this.disposables.disposeAll();
	}

	private syncSections(): void {
		if (!this.active) return;
		if (this.kernel.prefs.get('inspector.cslPreview.enable')) this.cslPreview.register();
		else this.cslPreview.unregister();

		this.lookupSection.setAnchorSectionID(this.cslPreview.sectionID);
		if (this.kernel.prefs.get('inspector.lookup.enable')) this.lookupSection.register();
		else this.lookupSection.unregister();

		if (this.kernel.prefs.get('inspector.pdfPreview.enable')) this.pdfPreview.register();
		else this.pdfPreview.unregister();

		if (this.kernel.prefs.get('inspector.pdfFolder.enable')) this.pdfFolder.register();
		else this.pdfFolder.unregister();

		if (this.kernel.prefs.get('inspector.wordCite.enable')
			&& this.kernel.prefs.get('modules.wordCite.enable')) {
			this.wordCiteSection.register();
		} else {
			this.wordCiteSection.unregister();
		}

		this.services.panePositions.queueAll();
	}
}

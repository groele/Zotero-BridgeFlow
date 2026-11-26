interface NativePointer { isNull(): boolean }
interface NativeNumber { value: number; address(): unknown }
interface NativeBuffer { length: number; readString(): string }
interface ScalarFactory { (value?: number): NativeNumber; ptr: unknown }
interface BufferFactory { ptr: unknown; array(length: number): () => NativeBuffer }
interface Point { address(): unknown }
interface PointFactory { (): Point; ptr: unknown }
interface NativeLibrary { declare(name: string, ...types: unknown[]): unknown; close(): void }
interface NativeCtypes {
	StructType: new (name: string, fields: unknown[]) => PointFactory;
	long: unknown; int32_t: unknown; voidptr_t: { ptr: unknown }; uint32_t: ScalarFactory;
	jschar: BufferFactory; winapi_abi: unknown; open(name: string): NativeLibrary;
}
interface NativeWin32Api {
	ctypes: NativeCtypes; POINT: PointFactory; user32: NativeLibrary; kernel32: NativeLibrary;
	getCursorPos(point: unknown): number; windowFromPoint(point: Point): NativePointer;
	getWindowThreadProcessId(window: NativePointer, process: unknown): number;
	openProcess(flags: number, inherit: boolean, id: number): NativePointer;
	queryFullProcessImageName(process: NativePointer, flags: number, buffer: NativeBuffer, size: unknown): number;
	closeHandle(process: NativePointer): number; getAncestor(window: NativePointer, flags: number): NativePointer;
	getForegroundWindow(): NativePointer;
	findWindowEx(parent: null, previous: NativePointer | null, name: string, title: null): NativePointer;
	isWindowVisible(window: NativePointer): number;
	getWindowText(window: NativePointer, buffer: NativeBuffer, size: number): number;
	pathBuffer: NativeBuffer; titleBuffer: NativeBuffer;
}

export type DropTargetResult = 'word-confirmed' | 'non-word' | 'unknown';

export function normalizeWordTitleForMatch(rawTitle: string): string {
	const cleaned = String(rawTitle || '')
		.replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\uFEFF]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!cleaned) return '';
	const wordSuffixRe = /\s+[-–—]\s+(?:Microsoft\s+)?Word(?:\s*\([^)]*\))?$/i;
	if (!wordSuffixRe.test(cleaned)) return cleaned;
	let body = cleaned.replace(wordSuffixRe, '').trim();
	const extMatch = body.match(/^(.+?\.(?:docx|docm|doc|dotx|dotm|rtf|odt))(?:\s*\[[^\]]*\]|\s+[-–—]\s+.*)*$/i);
	if (extMatch) return extMatch[1].trim();
	const statusRe = /(?:\s*\[(?:兼容模式|Compatibility Mode|只读|Read-Only|受保护的视图|Protected View|自动保存|AutoSave)[^\]]*\]|\s+[-–—]\s+(?:已保存.*|正在保存.*|上次保存.*|只读|兼容模式|受保护的视图|未保存|Saved.*|Saving.*|Last saved.*|Read-Only|Compatibility Mode|Protected View|Unsaved))\s*$/i;
	let prev = '';
	while (body && body !== prev) {
		prev = body;
		body = body.replace(statusRe, '').trim();
	}
	return body || cleaned;
}

/**
 * Shared Win32 ctypes bridge with deterministic handle disposal on shutdown.
 * Powers both drag-to-Word target confirmation and P1-B foreground Word title sync.
 */
export class Win32BridgeService {
	private cached: NativeWin32Api | null = null;
	private lastDroppedWordWindow: { title: string; at: number } | null = null;

	supportsNativeWin32(): boolean {
		const host = (globalThis as any).Zotero;
		if (!host) return true;
		if (host.isMac || host.isLinux) return false;
		if (typeof host.isWin === 'boolean') return host.isWin;
		const proc = (globalThis as any).process;
		return !proc?.platform || proc.platform === 'win32';
	}

	probeForegroundWordTitle(): string {
		if (!this.supportsNativeWin32()) return '';
		try {
			const api = this.getApi();
			return this.readForegroundWordTitle(api);
		} catch {
			return '';
		}
	}

	probeWordWindowTitles(): { foregroundTitle: string; visibleTitles: string[] } {
		if (!this.supportsNativeWin32()) return { foregroundTitle: '', visibleTitles: [] };
		try {
			const api = this.getApi();
			const foregroundTitle = this.readForegroundWordTitle(api);
			const visibleTitles: string[] = [];
			let current: NativePointer | null = null;
			for (let i = 0; i < 32; i++) {
				current = api.findWindowEx(null, current, 'OpusApp', null);
				if (!current || current.isNull()) break;
				if (!api.isWindowVisible(current)) continue;
				const title = this.readWindowTitle(api, current);
				if (title) visibleTitles.push(title);
			}
			return { foregroundTitle, visibleTitles };
		} catch {
			return { foregroundTitle: '', visibleTitles: [] };
		}
	}

	probeCursorWordDropTarget(): { status: DropTargetResult; windowTitle: string } {
		if (!this.supportsNativeWin32()) return { status: 'unknown', windowTitle: '' };
		try {
			const api = this.getApi();
			const pt = api.POINT();
			if (!api.getCursorPos(pt.address())) return { status: 'unknown', windowTitle: '' };
			const hwnd = api.windowFromPoint(pt);
			if (!hwnd || hwnd.isNull()) return { status: 'unknown', windowTitle: '' };
			const root = api.getAncestor(hwnd, 2);
			const target = root && !root.isNull() ? root : hwnd;
			if (!this.isWinWordWindow(api, target)) {
				return { status: 'non-word', windowTitle: this.readWindowTitle(api, target) };
			}
			const title = this.readWindowTitle(api, target);
			if (title) this.lastDroppedWordWindow = { title, at: Date.now() };
			return { status: 'word-confirmed', windowTitle: title };
		} catch {
			return { status: 'unknown', windowTitle: '' };
		}
	}

	clearLastDroppedWordTarget(): void {
		this.lastDroppedWordWindow = null;
	}

	setLastDroppedWordTargetForTest(title: string, at = Date.now()): void {
		this.lastDroppedWordWindow = title ? { title, at } : null;
	}

	verifyDroppedWordTarget(overrideActiveTitle?: string): boolean {
		const recorded = this.lastDroppedWordWindow;
		if (!recorded?.title || Date.now() - recorded.at > 15_000) return false;
		const expected = normalizeWordTitleForMatch(recorded.title);
		if (!expected) return false;
		if (overrideActiveTitle !== undefined) return normalizeWordTitleForMatch(overrideActiveTitle) === expected;
		const { foregroundTitle, visibleTitles } = this.probeWordWindowTitles();
		if (normalizeWordTitleForMatch(foregroundTitle) !== expected) return false;
		return visibleTitles.filter(title => normalizeWordTitleForMatch(title) === expected).length === 1;
	}

	dispose(): void {
		if (!this.cached) return;
		const { user32, kernel32 } = this.cached;
		this.cached = null;
		try { kernel32?.close(); } catch { /* ignore */ }
		try { user32?.close(); } catch { /* ignore */ }
	}

	private getApi(): NativeWin32Api {
		if (this.cached) return this.cached;
		const ctypes = (globalThis as any).ChromeUtils
			.importESModule('resource://gre/modules/ctypes.sys.mjs')
			.ctypes as NativeCtypes & { char16_t?: BufferFactory };
		const wchar = ctypes.char16_t ?? ctypes.jschar;
		const POINT = new ctypes.StructType('BridgeFlowDropPoint', [
			{ x: ctypes.long }, { y: ctypes.long },
		]);
		let user32: NativeLibrary | undefined;
		let kernel32: NativeLibrary | undefined;
		try {
			user32 = ctypes.open('user32.dll');
			kernel32 = ctypes.open('kernel32.dll');
			this.cached = {
				ctypes, POINT, user32, kernel32,
				getCursorPos: user32.declare('GetCursorPos', ctypes.winapi_abi, ctypes.int32_t, POINT.ptr),
				windowFromPoint: user32.declare('WindowFromPoint', ctypes.winapi_abi, ctypes.voidptr_t, POINT),
				getWindowThreadProcessId: user32.declare('GetWindowThreadProcessId', ctypes.winapi_abi, ctypes.uint32_t, ctypes.voidptr_t, ctypes.uint32_t.ptr),
				openProcess: kernel32.declare('OpenProcess', ctypes.winapi_abi, ctypes.voidptr_t, ctypes.uint32_t, ctypes.int32_t, ctypes.uint32_t),
				queryFullProcessImageName: kernel32.declare('QueryFullProcessImageNameW', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, wchar.ptr, ctypes.uint32_t.ptr),
				closeHandle: kernel32.declare('CloseHandle', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t),
				getAncestor: user32.declare('GetAncestor', ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.uint32_t),
				getForegroundWindow: user32.declare('GetForegroundWindow', ctypes.winapi_abi, ctypes.voidptr_t),
				findWindowEx: user32.declare('FindWindowExW', ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.voidptr_t, wchar.ptr, ctypes.voidptr_t),
				isWindowVisible: user32.declare('IsWindowVisible', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t),
				getWindowText: user32.declare('GetWindowTextW', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, wchar.ptr, ctypes.int32_t),
				pathBuffer: wchar.array(32768)(),
				titleBuffer: wchar.array(1024)(),
			} as unknown as NativeWin32Api;
			return this.cached;
		} catch (err) {
			try { kernel32?.close(); } catch { /* ignore */ }
			try { user32?.close(); } catch { /* ignore */ }
			throw err;
		}
	}

	private readWindowTitle(api: NativeWin32Api, hwnd: NativePointer | null): string {
		if (!hwnd || hwnd.isNull()) return '';
		const len = api.getWindowText(hwnd, api.titleBuffer, api.titleBuffer.length);
		return len > 0 ? api.titleBuffer.readString() : '';
	}

	private isWinWordWindow(api: NativeWin32Api, hwnd: NativePointer | null): boolean {
		if (!hwnd || hwnd.isNull()) return false;
		let handle: NativePointer | undefined;
		try {
			const pid = api.ctypes.uint32_t();
			if (!api.getWindowThreadProcessId(hwnd, pid.address()) || !pid.value) return false;
			handle = api.openProcess(0x1000, false, pid.value);
			if (handle.isNull()) return false;
			const len = api.ctypes.uint32_t(api.pathBuffer.length);
			if (!api.queryFullProcessImageName(handle, 0, api.pathBuffer, len.address())) return false;
			return api.pathBuffer.readString().split(/[\\/]/).pop()?.toLowerCase() === 'winword.exe';
		} catch {
			return false;
		} finally {
			if (handle && !handle.isNull()) {
				try { api.closeHandle(handle); } catch { /* ignore */ }
			}
		}
	}

	private readForegroundWordTitle(api: NativeWin32Api): string {
		const fg = api.getForegroundWindow();
		if (!fg || fg.isNull()) return '';
		const root = api.getAncestor(fg, 2);
		const target = root && !root.isNull() ? root : fg;
		return this.isWinWordWindow(api, target) ? this.readWindowTitle(api, target) : '';
	}
}

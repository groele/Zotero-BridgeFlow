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

/**
 * Shared Win32 ctypes bridge with deterministic handle disposal on shutdown.
 * Powers both drag-to-Word target confirmation and P1-B foreground Word title sync.
 */
export class Win32BridgeService {
	private cached: NativeWin32Api | null = null;

	supportsNativeWin32(): boolean {
		const host = (globalThis as any).Zotero;
		return typeof host === 'undefined' || host.isWin !== false;
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
			return { status: 'word-confirmed', windowTitle: this.readWindowTitle(api, target) };
		} catch {
			return { status: 'unknown', windowTitle: '' };
		}
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
			.ctypes as NativeCtypes;
		const POINT = new ctypes.StructType('BridgeFlowDropPoint', [
			{ x: ctypes.long }, { y: ctypes.long },
		]);
		const user32 = ctypes.open('user32.dll');
		const kernel32 = ctypes.open('kernel32.dll');
		this.cached = {
			ctypes, POINT, user32, kernel32,
			getCursorPos: user32.declare('GetCursorPos', ctypes.winapi_abi, ctypes.int32_t, POINT.ptr),
			windowFromPoint: user32.declare('WindowFromPoint', ctypes.winapi_abi, ctypes.voidptr_t, POINT),
			getWindowThreadProcessId: user32.declare('GetWindowThreadProcessId', ctypes.winapi_abi, ctypes.uint32_t, ctypes.voidptr_t, ctypes.uint32_t.ptr),
			openProcess: kernel32.declare('OpenProcess', ctypes.winapi_abi, ctypes.voidptr_t, ctypes.uint32_t, ctypes.int32_t, ctypes.uint32_t),
			queryFullProcessImageName: kernel32.declare('QueryFullProcessImageNameW', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.jschar.ptr, ctypes.uint32_t.ptr),
			closeHandle: kernel32.declare('CloseHandle', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t),
			getAncestor: user32.declare('GetAncestor', ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.uint32_t),
			getForegroundWindow: user32.declare('GetForegroundWindow', ctypes.winapi_abi, ctypes.voidptr_t),
			findWindowEx: user32.declare('FindWindowExW', ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.jschar.ptr, ctypes.voidptr_t),
			isWindowVisible: user32.declare('IsWindowVisible', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t),
			getWindowText: user32.declare('GetWindowTextW', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.jschar.ptr, ctypes.int32_t),
			pathBuffer: ctypes.jschar.array(32768)(),
			titleBuffer: ctypes.jschar.array(1024)(),
		} as unknown as NativeWin32Api;
		return this.cached;
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

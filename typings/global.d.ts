declare const __BRIDGEFLOW_VERSION__: string;
declare const __BRIDGEFLOW_BUILD_TIME__: string;

declare function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(callback: (...args: any[]) => void, ms?: number, ...args: any[]): number;
declare function clearInterval(id?: number): void;

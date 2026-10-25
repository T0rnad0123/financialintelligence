export const COMPANY: string;
export const SHARES: number;
export const FACE_VALUE: number;
export function annual(fy: number): Record<string, number>;
export function balance(fy: number): Record<string, number>;
export function cashflow(fy: number): Record<string, number>;
export function quarter(fy: number, q: number): Record<string, number>;
export function ytd(fy: number, q: number): Record<string, number>;

import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function PageShell({ children, className = "" }: { readonly children: ReactNode; readonly className?: string }) {
  return <main className={`mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 ${className}`}>{children}</main>;
}

export function Badge({ children }: { readonly children: ReactNode }) {
  return <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{children}</span>;
}

export function FormField({ label, hint, ...props }: ComponentPropsWithoutRef<"input"> & { readonly label: string; readonly hint?: string }) {
  return (
    <label className="grid gap-2 text-sm font-bold">
      {label}
      <input {...props} className={`min-h-12 rounded-xl border border-slate-300 px-4 ${props.className ?? ""}`} />
      {hint ? <span className="text-xs font-normal text-slate-500">{hint}</span> : null}
    </label>
  );
}

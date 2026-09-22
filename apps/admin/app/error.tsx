"use client";
export default function ErrorBoundary({reset}:{error:Error&{digest?:string};reset:()=>void}){return <main className="shell page"><div className="empty-state" role="alert"><h1>This page could not be loaded.</h1><p>The request did not complete. Your payment and account records remain on the server.</p><button className="button primary" onClick={reset}>Try again</button></div></main>;}

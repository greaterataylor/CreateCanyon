import {networkProxy} from '@createcanyon/web/proxy';
export const proxy=networkProxy;
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};

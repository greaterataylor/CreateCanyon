import {redirect} from 'next/navigation';
import {appUrl} from '@createcanyon/web/server';
export default function Cart(){redirect(appUrl('dashboard')+'/cart');}

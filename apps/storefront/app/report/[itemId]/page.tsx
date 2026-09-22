import {PageHeading} from '@createcanyon/web/components';
import ReportForm from './report-form';
export default async function Report({params}:{params:Promise<{itemId:string}>}){return <div className="shell page"><PageHeading eyebrow="TRUST & RIGHTS" title="Report copyright infringement.">Provide the details needed to review this specific item. Do not include sensitive identity documents in the report.</PageHeading><ReportForm itemId={(await params).itemId}/></div>;}

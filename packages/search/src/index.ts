export interface SearchDocument {
  id:string; item_id:string; channel:string; title:string; description:string; tags:string[];
  asset_type:string; category:string; price:number; rating:number; sales:number; published_at:number;
}
export class TypesenseIndex {
  constructor(readonly url:string,readonly apiKey:string){}
  async request(path:string,init:RequestInit={}) {
    const result=await fetch(new URL(path,this.url),{...init,headers:{"x-typesense-api-key":this.apiKey,"content-type":"application/json",...init.headers},signal:AbortSignal.timeout(5000)});
    if(!result.ok)throw new Error(`Typesense HTTP ${result.status}`);
    return result;
  }
  async ensureCollection() {
    const response=await fetch(new URL("/collections/listings",this.url),{headers:{"x-typesense-api-key":this.apiKey},signal:AbortSignal.timeout(5000)});
    if(response.ok)return;
    if(response.status!==404)throw new Error("Typesense unavailable");
    try{await this.request("/collections",{method:"POST",body:JSON.stringify({name:"listings",fields:[
      {name:"item_id",type:"string",facet:true},{name:"channel",type:"string",facet:true},
      {name:"title",type:"string"},{name:"description",type:"string"},{name:"tags",type:"string[]"},
      {name:"asset_type",type:"string",facet:true},{name:"category",type:"string",facet:true},
      {name:"price",type:"int64"},{name:"rating",type:"float"},{name:"sales",type:"int32"},{name:"published_at",type:"int64"}
    ],default_sorting_field:"sales"})});}catch(error){
      const check=await fetch(new URL("/collections/listings",this.url),{headers:{"x-typesense-api-key":this.apiKey},signal:AbortSignal.timeout(5000)});if(!check.ok)throw error;
    }
  }
  async upsert(doc:SearchDocument) {await this.request("/collections/listings/documents?action=upsert",{method:"POST",body:JSON.stringify(doc)});}
  async removeItem(itemId:string){if(!/^[0-9a-f-]{36}$/i.test(itemId))throw new Error("Invalid item id");await this.request(`/collections/listings/documents?filter_by=${encodeURIComponent("item_id:="+itemId)}`,{method:"DELETE"});}
  async search(input:{q:string;channel:string;category?:string;assetType?:string;page:number;pageSize:number;sort:string}) {
    const literal=(s:string)=>"`"+s.replace(/[`\\]/g,"")+"`";
    const filters=["channel:="+literal(input.channel)];
    if(input.category)filters.push("category:="+literal(input.category));if(input.assetType)filters.push("asset_type:="+literal(input.assetType));
    const sort=({relevance:"_text_match:desc,sales:desc",newest:"published_at:desc",rating:"rating:desc",sales:"sales:desc",price_asc:"price:asc",price_desc:"price:desc"} as Record<string,string>)[input.sort]??"_text_match:desc";
    const query=new URLSearchParams({q:input.q||"*",query_by:"title,tags,description",query_by_weights:"5,3,1",filter_by:filters.join(" && "),page:String(input.page),per_page:String(input.pageSize),sort_by:sort,num_typos:"2,1,1"});
    return await (await this.request(`/collections/listings/documents/search?${query}`)).json() as {found:number;hits?:Array<{document:SearchDocument}>};
  }
}

import assert from "node:assert/strict";
import test from "node:test";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { DiscoveryRepository } from "../src/lib/discovery/repository.ts";
import { resolveDiscoveryQueryCells } from "../src/lib/discovery/query-matrix.ts";

function fakeClient(respond: (sql:string,params:unknown[])=>unknown[]) {
  const calls:Array<{sql:string;params:unknown[]}>=[];
  const tagged=async()=>[{is_review_workspace:true}];
  const client=Object.assign(tagged,{query:async(sql:string,params:unknown[]=[])=>{calls.push({sql,params});return respond(sql,params);}}) as unknown as NeonQueryFunction<false,false>;
  return{client,calls};
}

test("repository rejects broad or underfunded launches before database access",async()=>{
  const {client,calls}=fakeClient(()=>[]);
  const repository=new DiscoveryRepository(()=>client);
  const cells=resolveDiscoveryQueryCells({categories:["wic"],counties:["Cook"],maxCells:2});
  await assert.rejects(()=>repository.launch({idempotencyKey:"key",cells,uniqueLeadCap:10,providerCallBudget:1,actorSubject:"operator"}),/cover query cells/);
  await assert.rejects(()=>repository.launch({idempotencyKey:"key",cells:[],uniqueLeadCap:10,providerCallBudget:10,actorSubject:"operator"}),/1-10 frozen/);
  assert.equal(calls.length,0);
});

test("launch freezes cells and actor in one fenced persistence statement",async()=>{
  const {client,calls}=fakeClient((sql)=>sql.includes("select id from inserted_run")?[{id:"00000000-0000-4000-8000-000000000001"}]:[]);
  const repository=new DiscoveryRepository(()=>client);
  const cells=resolveDiscoveryQueryCells({categories:["wic"],counties:["Cook"],maxCells:2});
  const run=await repository.launch({idempotencyKey:"launch-key",cells,uniqueLeadCap:10,providerCallBudget:20,actorSubject:"operator:1"});
  assert.equal(run.id,"00000000-0000-4000-8000-000000000001");
  assert.equal(calls.length,1);
  assert.match(calls[0]!.sql,/discovery_daily_budgets/);
  assert.match(calls[0]!.sql,/discovery_query_cells/);
  assert.match(calls[0]!.sql,/discovery_run_events/);
  assert.equal(calls[0]!.params[5],"operator:1");
  assert.deepEqual(JSON.parse(String(calls[0]!.params[2])),cells);
});

test("operator lifecycle mutations retain the acting subject",async()=>{
  const {client,calls}=fakeClient((sql)=>sql.includes("select exists(select 1 from updated_campaign)")?[{resumed:true}]:[]);
  const repository=new DiscoveryRepository(()=>client);
  const runId="00000000-0000-4000-8000-000000000001";
  await repository.pause(runId,"operator:pause");
  await repository.resume(runId,"operator:resume");
  await repository.cancel(runId,"operator:cancel");
  assert.deepEqual(calls.map((call)=>call.params[1]),["operator:pause","operator:resume","operator:cancel"]);
  assert.ok(calls.every((call)=>call.sql.includes("discovery_run_events")));
});

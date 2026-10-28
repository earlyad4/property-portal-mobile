import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBootstrap } from '../lib/normalize.ts';
test('server maintenance fields normalize to the mobile ticket contract', () => {
 const b=normalizeBootstrap({tenant:{id:'demo'},maintenanceRequests:[{id:'request',status:'Completed',submittedAt:'start',updated_at:'end',timeline:[{requestId:'request',author_kind:'admin',author:'Demo operator',at:'time',message:'Done'}]}]});
 assert.equal(b.tickets[0].status,'resolved');
 assert.equal(b.tickets[0].createdAt,'start');
 assert.equal(b.tickets[0].updatedAt,'end');
 assert.equal(b.tickets[0].messages[0].ticketId,'request');
 assert.equal(b.tickets[0].messages[0].authorKind,'admin');
});
test('broadcast dismissal is scoped to the current synthetic resident', () => {
 const b=normalizeBootstrap({tenant:{id:'demo'},broadcasts:[{message:'Notice',createdAt:'time',dismissedBy:['demo']},{message:'Other',dismissedBy:['someone-else']}]});
 assert.equal(b.broadcasts[0].body,'Notice');
 assert.equal(b.broadcasts[0].acknowledgedAt,'time');
 assert.equal(b.broadcasts[1].acknowledgedAt,undefined);
});
test('empty datasets remain usable and document fields normalize', () => {
 const b=normalizeBootstrap({documents:[{type:'Lease',status:'Verified',submittedAt:'time'}]});
 assert.deepEqual(b.tickets,[]);
 assert.deepEqual(b.broadcasts,[]);
 assert.equal(b.documents[0].kind,'Lease');
 assert.equal(b.documents[0].status,'verified');
});

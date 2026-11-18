const mongoose = require('mongoose');
const M = require('../../bingo-api/pilot/models');
const I = require('../../bingo-api/pilot/imports');
const C = require('../../bingo-api/pilot/cards');
const G = require('../../bingo-api/pilot/game');
const E = require('../../bingo-api/pilot/game-engine');
const P = require('../../bingo-api/pilot/prizes');
const Contact = require('../../bingo-api/pilot/contacts');
const { createEdition } = require('../../bingo-api/pilot/persistence');
const { generateCells } = require('../../bingo-api/pilot/card-generator');
const oid = () => new mongoose.Types.ObjectId();
const rules = (extra = {}) => ({
  roundMode: 'independent',
  extractionMode: 'manual',
  order: E.names,
  repeatWinners: true,
  pauseDuringContact: false,
  roundingPolicy: 'auditable_residual_draw',
  discardPolicy: 'redistribute_confirmed',
  noResponsePolicy: 'advance_keep_unassigned',
  contactClockStart: 'operator_confirms_notice',
  maskReviewConfirmed: true,
  confirmationReference: 'Synthetic prize tests',
  figures: E.names.map((name) => ({
    name,
    poolClp: E.pools[name],
    mask: ['10000', '00000', '00100', '00000', '00000']
  })),
  ...extra
});
function helpers(actorId) {
  async function command(editionId, input = {}) {
    if (input.proposalId && input.reviewed === true && input.reviewedSnapshotHash === undefined) {
      const proposal = await M.PrizeProposal.findById(input.proposalId);
      input = { ...input, reviewedSnapshotHash: proposal ? proposal.snapshotHash : null };
    }
    return {
      editionId,
      actorId,
      key: `prize-${oid()}`,
      expectedVersion: (await M.Edition.findById(editionId)).version,
      input
    };
  }
  async function ball(id, number) {
    return G.draw(
      await command(id, { roundId: String((await M.Edition.findById(id)).currentRoundId), number })
    );
  }
  async function fixture(count = 3, extra = {}, firstNumbers = [1]) {
    const id = oid();
    await createEdition({ editionId: id, actorId, name: 'Synthetic prize edition' });
    const csv =
      'email,telefono,jugador_id,nombre\n' +
      Array.from(
        { length: count },
        (_, i) => `p${i}@example.invalid,+569${String(i).padStart(8, '0')},player-${i},Synthetic ${i}`
      ).join('\n');
    const file = await I.stageImport(
      await command(id, {
        filename: 'synthetic.csv',
        contentBase64: Buffer.from(csv).toString('base64'),
        sourceReference: 'Synthetic Polla list'
      })
    );
    await I.applyImport(await command(id, { importId: file.importId }));
    await C.configureCards(
      await command(id, {
        settings: {
          minNumber: 1,
          maxNumber: 75,
          columnMode: 'unrestricted',
          confirmationReference: 'Synthetic variant'
        }
      })
    );
    let n = 0;
    await C.issueBatch(await command(id, { limit: 100 }), {
      generate: (settings) => {
        const cells = generateCells(settings),
          target = firstNumbers[n++ % firstNumbers.length],
          old = cells.indexOf(target);
        if (old >= 0) [cells[old], cells[0]] = [cells[0], cells[old]];
        else cells[0] = target;
        return cells;
      }
    });
    await I.closeList(await command(id));
    await G.configure(await command(id, { settings: rules(extra) }));
    await G.prepare(await command(id));
    await G.start(await command(id));
    return id;
  }
  async function resolve(id, outcomes = [], resultId) {
    const result = await M.FigureResult.findOne({
      editionId: id,
      roundId: (await M.Edition.findById(id)).currentRoundId,
      state: 'detected',
      ...(resultId ? { _id: resultId } : {})
    });
    const rows = (
      await M.Candidate.find({
        editionId: id,
        roundId: result.roundId,
        figure: result.figure,
        cohort: 'primary'
      }).sort({ _id: 1 })
    ).filter((c) => (c.allocationCycle || 0) === (result.allocationCycle || 0));
    let now = Date.now() - 120000;
    const service = Contact.createService(() => new Date(now));
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i];
      if (c.state === 'confirmed' || c.state === 'discarded') continue;
      await service.begin(
        await command(id, { candidateId: c.id, channel: 'email', evidence: 'Synthetic contact attempt' })
      );
      const notice = await service.notice(
        await command(id, { candidateId: c.id, success: true, evidence: 'Synthetic successful notice' })
      );
      if (outcomes[i] === 'discarded') {
        now += 60001;
        await service.discard(
          await command(id, {
            candidateId: c.id,
            reviewedNoTimelyResponse: true,
            evidence: 'Channel reviewed; no timely response'
          })
        );
      } else {
        now += 100;
        await service.respond(
          await command(id, {
            candidateId: c.id,
            receivedAt: new Date(notice.contactStartedAt).toISOString(),
            evidence: 'Channel proves timely receipt'
          })
        );
      }
      if (
        outcomes[i] !== 'discarded' &&
        !(await M.PollaAccount.exists({ editionId: id, participantId: c.participantId }))
      )
        await P.verifyAccount(
          await command(id, {
            participantId: c.participantId.toString(),
            accountReference: `polla-${c.participantId}`,
            evidence: 'Polla confirmed synthetic account ownership',
            verifiedWithPolla: true
          })
        );
    }
    return M.FigureResult.findById(result._id);
  }
  async function prepare(id, result) {
    return P.prepare(
      await command(id, { resultId: result.id, reason: 'Review synthetic pool distribution' })
    );
  }
  async function settle(id, result, extras = {}) {
    const p = await prepare(id, result);
    return P.confirm(
      await command(id, {
        proposalId: p.proposalId,
        reviewed: true,
        reason: 'All candidates, accounts and monetary destination reviewed',
        ...extras
      })
    );
  }
  return { command, fixture, ball, resolve, prepare, settle };
}
module.exports = { helpers, rules };

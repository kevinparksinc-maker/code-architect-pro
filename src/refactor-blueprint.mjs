/** Converts static evidence into file-specific architectural change-set proposals.
 * These are NOT automatically applied; an agent/developer must validate behavior.
 */
import posix from 'node:path/posix';
const uniq = arr=>[...new Set(arr.filter(Boolean))];
function proposedSharedLocation(files) {
  const dirs=files.map(f=>posix.dirname(f).split('/'));
  const common=[];
  for(let i=0;i<Math.min(...dirs.map(d=>d.length));i++)if(dirs.every(d=>d[i]===dirs[0][i]))common.push(dirs[0][i]);else break;
  const base=common.join('/');return posix.join(base==='.'?'src':base||'src','shared','extracted-logic.ts');
}
export function buildRefactorBlueprint(report){
  const changes=[];
  for(const finding of report.findings){
    let files,approach,proposed,validation,risks,transform;
    switch(finding.rule){
      case 'duplicate-function-body': {
        files=uniq(Array.isArray(finding.evidence)?finding.evidence.map(e=>e.file):[]);
        approach='Extract identical semantics into a cohesive, shared implementation';
        proposed={sharedModuleCandidate:proposedSharedLocation(files),affectedFiles:files,sourceImplementations:finding.evidence};
        validation=['Confirm parameter/return contracts, closure captures, imports and side effects.','Prove representative and edge-case outputs match across both original functions.','Keep original exported function names as wrappers when consumers depend on them.','Run type checks and regression tests for all callers.'];
        risks=['Textually identical bodies can have different closure variables, public contracts or ownership.'];
        transform=['Compare source functions and obtain approval.','Create an extracted shared implementation with explicit dependencies.','Replace duplicate bodies with wrappers/forwarders preserving public APIs.','Run baseline/changed tests and roll back on differences.'];break;
      }
      case 'circular-dependency': {
        files=uniq(Array.isArray(finding.evidence)?finding.evidence:[]);
        approach='Remove dependency cycle through shared kernel or dependency inversion';
        proposed={cycle:files,sharedContractsCandidate:proposedSharedLocation(files).replace('extracted-logic.ts','contracts.ts'),affectedFiles:files};
        validation=['List every import direction and module initialization side effect.','Identify the lowest-risk import edge to invert.','Rescan to prove this exact cycle is removed and no new cycles appear.','Test startup and the involved public exports.'];
        risks=['Moving initialization logic can change startup order or create hidden runtime dependencies.'];
        transform=['Identify cycle members and ownership.','Choose one extraction/inversion strategy.','Keep external entrypoints stable.','Migrate one edge then validate before continuing.'];break;
      }
      case 'high-coupling-hub': {
        files=[finding.location.file];approach='Investigate stable facade and separation of internal responsibilities';
        proposed={facadeToPreserve:finding.location.file,consumers:(report.graph.edges||[]).filter(e=>e.to===finding.location.file).map(e=>e.from),affectedFiles:files};
        validation=['Classify export consumers by actual responsibility.','Keep an existing facade if it is a public API.','Build contract tests for every migrated consumer.'];
        risks=['A high-use cohesive library may already have the correct architecture.'];
        transform=['Partition consumers by contract.','Split internal implementation only when genuinely cohesive groups exist.','Preserve stable facade exports and migrate in waves.'];break;
      }
      case 'excessive-fan-out': {
        files=[finding.location.file];approach='Reduce layer mixing and split orchestration from domain code';
        proposed={candidateCoordinator:finding.location.file,dependencies:(report.graph.edges||[]).filter(e=>e.from===finding.location.file).map(e=>e.to).filter(Boolean),affectedFiles:files};
        validation=['Classify imports: domain, infrastructure, UI, composition root.','Keep legitimate composition-root wiring together.','Measure dependency and build changes in the same environment.'];
        risks=['Moving code without understanding orchestration can create extra dependency layers.'];
        transform=['Map dependency ownership.','Extract domain calculations to smaller pure units where justified.','Keep integration logic in one coordinator.','Validate call paths and integration tests.'];break;
      }
      case 'async-foreach': {
        files=[finding.location.file];approach='Use explicit sequential or bounded-parallel async control flow';
        proposed={affectedFiles:files,alternatives:['for...of with await','bounded promise worker pool']};
        validation=['Determine if order, concurrency and partial failures matter.','Verify all promises are awaited.','Measure latency and API rate-limit behavior using the same inputs.'];
        risks=['Replacing with unbounded Promise.all can cause overload or out-of-order side effects.'];
        transform=['Add failing async-order/error tests.','Choose bounded parallelism or sequential semantics.','Apply localized change and run failure simulations.'];break;
      }
      default:continue;
    }
    changes.push({id:`change-set-${changes.length+1}`,findingId:finding.id,rule:finding.rule,confidence:finding.confidence,
      title:finding.title,approach,sourceEvidence:finding.location,affectedFiles:files,proposed,transform,validation,risks,
      status:'proposal-not-applied',requiresApproval:true,expectedMeasurements:['correctness and API contracts','dependency graph after change','actual app benchmarks when available']});
  }
  return {version:'0.3',goal:'Make structure more maintainable without silently changing behavior.',
    changeSets:changes,rule:'These are grounded, actionable designs, NOT verified or applied code changes. A trusted agent must inspect source, make patches in a copy, and pass acceptance tests.'};
}

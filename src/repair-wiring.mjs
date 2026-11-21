/** Check an explicit contract against the post-repair static graph. */
export function checkRepairWiring(report, {entry, caller, callee, replaces}) {
  const {nodes,edges,calls} = report.graph;
  const pending = [entry];
  const parents = new Map([[entry,null]]);
  const adjacency = new Map();
  for (const edge of edges) {
    if (!edge.to || (edge.kind !== 'runtime' && edge.kind !== 'dynamic')) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from,[]);
    adjacency.get(edge.from).push(edge);
  }
  for (let i=0;i<pending.length;i++) {
    for (const edge of adjacency.get(pending[i]) ?? []) {
      if (parents.has(edge.to)) continue;
      parents.set(edge.to,edge);
      pending.push(edge.to);
    }
  }

  const source = calls.nodes.find(node=>node.id===caller);
  const entryExists = nodes.includes(entry);
  const path = [];
  if (entryExists && parents.has(source?.file)) {
    for (let edge=parents.get(source.file);edge;edge=parents.get(edge.from)) path.unshift(edge);
  }
  const reachable = entryExists && parents.has(source?.file);
  const directCall = calls.edges.find(edge=>edge.from===caller && edge.to===callee) ?? null;
  const previousCall = replaces ? calls.edges.find(edge=>edge.from===caller && edge.to===replaces) ?? null : null;
  return {
    entry,caller,callee,...(replaces ? {replaces} : {}),
    status: reachable && directCall && !previousCall ? 'static-match' : 'unconfirmed',
    reachable,
    path,
    directCall,
    previousCall,
  };
}

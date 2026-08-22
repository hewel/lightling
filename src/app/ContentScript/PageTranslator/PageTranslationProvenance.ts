export interface PageTranslationProvenance {
  markNodes(nodes: Iterable<Node>): void;
  isOurs(node: Node): boolean;
  unmark(node: Node): void;
}

const createPageTranslationProvenance = (): PageTranslationProvenance => {
  const appliedNodes = new WeakSet<Node>();

  return {
    markNodes(nodes) {
      for (const node of nodes) appliedNodes.add(node);
    },
    isOurs(node) {
      return appliedNodes.has(node);
    },
    unmark(node) {
      appliedNodes.delete(node);
    },
  };
};

export const pageTranslationProvenance = createPageTranslationProvenance();

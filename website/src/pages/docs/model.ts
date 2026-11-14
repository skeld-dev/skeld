// Does:  Defines the static documentation page and search records shared by build and browser code.
// Holds: Content originates in the repository docs; browser imports of these types carry no Markdown renderer.

export interface DocDefinition {
  source: string;
  url: string;
  label: string;
  group: string;
  parent?: string;
}
export interface DocHeading {
  id: string;
  label: string;
  depth: number;
}
export interface DocPage extends DocDefinition {
  markdownUrl: string;
  title: string;
  titleId: string;
  description: string;
  html: string;
  headings: DocHeading[];
}
export interface SearchEntry {
  url: string;
  title: string;
  group: string;
  text: string;
}

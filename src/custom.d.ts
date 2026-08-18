declare module '*.css';

declare module '*.css.txt' {
  const url: string;
  export default url;
}


declare module '*.svg' {
	const ReactComponent: React.FC<React.SVGProps<SVGSVGElement>>;
	export default ReactComponent;
}

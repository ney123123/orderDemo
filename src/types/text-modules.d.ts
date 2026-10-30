// Prompt templates bundled as text into the Lambda (esbuild loader { ".md": "text" }).
declare module "*.md" {
  const text: string;
  export default text;
}

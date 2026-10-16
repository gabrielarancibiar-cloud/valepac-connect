// Superficie usada por el archivo autónomo; las API web se tipan con lib.dom.
declare const Deno: {
  env: { get(nombre: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,PUT,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
}

export function handleOptions(request: Request) {
  let headers = request.headers;
  if (
    headers.get("Origin") !== null &&
    headers.get("Access-Control-Request-Method") !== null
  ){
    let respHeaders: { [name: string]: string } = corsHeaders;
    if  ("Access-Control-Request-Methods" in respHeaders) {
      respHeaders["Access-Control-Allow-Headers"] = request.headers.get("Access-Control-Request-Headers")!
    }

    return new Response(null, {
      headers: respHeaders,
    })
  }
  else {
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, POST, PUT, OPTIONS",
      },
    })
  }
}

export function corsWrapResponse(response: Response) {
  if (response.headers !== undefined)
    response.headers.set("Access-Control-Allow-Origin", "*")
  return response
}

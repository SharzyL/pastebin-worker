const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,PUT,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
}

export function handleOptions(request: Request) {
  const headers = request.headers
  if (headers.get("Origin") !== null && headers.get("Access-Control-Request-Method") !== null) {
    const respHeaders: { [name: string]: string } = corsHeaders
    respHeaders["Access-Control-Allow-Headers"] = "*"

    return new Response(null, {
      headers: respHeaders,
    })
  } else {
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, POST, PUT, OPTIONS, DELETE",
      },
    })
  }
}

export function corsWrapResponse(response: Response) {
  if (response.headers !== undefined) response.headers.set("Access-Control-Allow-Origin", "*")
  return response
}

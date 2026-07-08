import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/api/whatsapp/webhook', '/favicon.ico'];

function parseUsers(raw: string | undefined): Map<string, string> {
  const users = new Map<string, string>();
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) continue;
    users.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return users;
}

function unauthorized() {
  return new NextResponse('Autenticación requerida', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="KW2 Mesa", charset="UTF-8"',
    },
  });
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/whatsapp/webhook') ||
    PUBLIC_PATHS.includes(pathname)
  ) {
    return NextResponse.next();
  }

  const users = parseUsers(process.env.KW2_BASIC_AUTH_USERS);
  if (users.size === 0) return NextResponse.next();

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Basic ')) return unauthorized();

  let decoded = '';
  try {
    decoded = atob(authorization.slice('Basic '.length));
  } catch {
    return unauthorized();
  }

  const separator = decoded.indexOf(':');
  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  if (!username || users.get(username) !== password) return unauthorized();

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};

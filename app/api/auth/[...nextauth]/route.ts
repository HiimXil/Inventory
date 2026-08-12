import { Auth } from "@auth/core";
import { authOptions } from "@/lib/auth/options";

export async function GET(request: Request) {
  return (await Auth(request, authOptions)) as unknown as Response;
}

export async function POST(request: Request) {
  return (await Auth(request, authOptions)) as unknown as Response;
}

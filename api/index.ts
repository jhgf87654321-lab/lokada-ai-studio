/**
 * Vercel serverless entry: 所有请求通过 rewrites 指向 /api，由此文件接收并交给 Express app 处理。
 */
import { handler } from "../server";
export default handler;

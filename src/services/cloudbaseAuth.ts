/**
 * CloudBase 认证服务 - 前端客户端
 * 用于浏览器环境下的用户登录注册
 */

import cloudbase from "@cloudbase/js-sdk";

const env = import.meta.env.VITE_CLOUDBASE_ENV || "denglu-8gher1d52a21e6fe";
const clientId = import.meta.env.VITE_CLOUDBASE_CLIENT_ID || "denglu-8gher1d52a21e6fe";
const region = import.meta.env.VITE_CLOUDBASE_REGION || "ap-shanghai";
const accessKey = import.meta.env.VITE_CLOUDBASE_ACCESS_KEY || clientId;

let appInstance: ReturnType<typeof cloudbase.init> | null = null;

/**
 * 获取 CloudBase App 实例
 */
export function getCloudbaseApp() {
  if (typeof window === "undefined") {
    console.warn("[CloudBase] 服务端环境不支持 CloudBase 客户端 SDK");
    return null;
  }
  if (!env || !accessKey) {
    console.warn("[CloudBase] 环境变量未配置:", {
      env: env || "未设置",
      accessKey: accessKey || "未设置",
      region: region || "未设置",
    });
    return null;
  }
  if (!appInstance) {
    const initConfig: any = {
      env,
      region,
      accessKey,
      auth: { detectSessionInUrl: true },
    };
    appInstance = cloudbase.init(initConfig);
  }
  return appInstance;
}

/**
 * 获取 CloudBase Auth 实例
 */
export function getCloudbaseAuth() {
  const app = getCloudbaseApp();
  return app ? app.auth : null;
}

/**
 * 手机号密码登录
 */
export async function loginWithPhonePassword(phone: string, password: string) {
  const auth = getCloudbaseAuth();
  if (!auth) {
    throw new Error("CloudBase 未初始化");
  }
  return await auth.signInWithPhoneAndPassword(phone, password);
}

/**
 * 邮箱密码登录
 */
export async function loginWithEmailPassword(email: string, password: string) {
  const auth = getCloudbaseAuth();
  if (!auth) {
    throw new Error("CloudBase 未初始化");
  }
  return await auth.signInWithEmailAndPassword(email, password);
}

/**
 * 手机号验证码注册
 */
export async function registerWithPhone(phone: string, code: string, password: string, profile?: { nickname?: string; name?: string }) {
  const auth = getCloudbaseAuth();
  if (!auth) {
    throw new Error("CloudBase 未初始化");
  }

  // 验证验证码
  const verification = await auth.verify(phone, code, "register");

  // 创建用户
  const { userInfo } = await auth.signUp({
    email: phone,
    password,
    ...profile,
  });

  return userInfo;
}

/**
 * 邮箱验证码注册
 */
export async function registerWithEmail(email: string, code: string, password: string, profile?: { nickname?: string; name?: string }) {
  const auth = getCloudbaseAuth();
  if (!auth) {
    throw new Error("CloudBase 未初始化");
  }

  // 验证验证码
  const verification = await auth.verify(email, code, "register");

  // 创建用户
  const { userInfo } = await auth.signUp({
    email,
    password,
    ...profile,
  });

  return userInfo;
}

/**
 * 获取验证码
 */
export async function getVerification(phoneOrEmail: string, purpose: "login" | "register" | "resetPassword" = "register") {
  const auth = getCloudbaseAuth();
  if (!auth) {
    throw new Error("CloudBase 未初始化");
  }
  return await auth.getVerification(phoneOrEmail, purpose);
}

/**
 * 获取当前登录用户
 */
export async function getCurrentUser() {
  const auth = getCloudbaseAuth();
  if (!auth) {
    return null;
  }
  try {
    const loginState = await auth.getLoginState();
    return loginState?.user || null;
  } catch {
    return null;
  }
}

/**
 * 登出
 */
export async function logout() {
  const auth = getCloudbaseAuth();
  if (!auth) {
    return;
  }
  await auth.signOut();
}

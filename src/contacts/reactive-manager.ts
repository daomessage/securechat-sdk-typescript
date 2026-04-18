/**
 * @deprecated 0.3.0 过渡层, 0.4.0 已用 ContactsModule (contacts/module.ts) 取代。
 * 本文件保留仅是为了让当前代码树 tsc 通过 —— 晚上应用 PATCH_ROOT_FILES_0_4_0.md
 * 把 index.ts 替换为 index-v2.ts 之后, 本文件会被一并删除。
 */
export { ContactsModule as ReactiveContactsModule } from './module'

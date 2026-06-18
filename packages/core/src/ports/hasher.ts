/** Synchronous MD5-hex hasher. The host supplies the implementation
 *  (node:crypto on desktop, a pure-JS md5 on React Native) so core stays
 *  dependency-free. Input is UTF-8; output is lowercase hex. */
export type Hasher = (input: string) => string;

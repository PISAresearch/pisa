/**
 * Returns a Promise that resolves after waiting `milliseconds`.
 * @param milliseconds
 */
export const wait = (milliseconds: number) => {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
};
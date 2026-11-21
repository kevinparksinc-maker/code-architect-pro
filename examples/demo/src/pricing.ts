export function calculatePrice(amount: number) {
  const baseValue = amount * 1.20;
  const salesTax = baseValue * 0.0825;
  const finalAmount = Math.round((baseValue + salesTax) * 100) / 100;
  return finalAmount;
}

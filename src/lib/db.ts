import { PrismaClient } from "@prisma/client";

// Singleton Prisma — évite l'épuisement des connexions en dev (hot reload)
// et fournit un point d'accès unique testable.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

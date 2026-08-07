import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '@/middleware/auth';

const router = Router();
const prisma = new PrismaClient();

router.get('/', authenticate, async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  res.json(users);
});

router.get('/:id', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });

  res.json(user);
});

router.patch('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  const { firstName, lastName, isActive } = req.body;

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: {
      firstName,
      lastName,
      isActive,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
    },
  });

  res.json(user);
});

export default router;

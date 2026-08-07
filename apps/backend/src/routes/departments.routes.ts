import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '@/middleware/auth';

const router = Router();
const prisma = new PrismaClient();

const departmentSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  description: z.string().optional(),
  budget: z.number().optional(),
});

router.get('/', authenticate, async (req, res) => {
  const departments = await prisma.department.findMany();
  res.json(departments);
});

router.post('/', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const data = departmentSchema.parse(req.body);

  const department = await prisma.department.create({
    data,
  });

  res.status(201).json(department);
});

router.get('/:id', authenticate, async (req, res) => {
  const department = await prisma.department.findUnique({
    where: { id: req.params.id },
  });

  res.json(department);
});

router.patch('/:id', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const data = departmentSchema.partial().parse(req.body);

  const department = await prisma.department.update({
    where: { id: req.params.id },
    data,
  });

  res.json(department);
});

router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  await prisma.department.delete({
    where: { id: req.params.id },
  });

  res.status(204).send();
});

export default router;

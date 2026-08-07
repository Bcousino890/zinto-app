import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '@/middleware/auth';

const router = Router();
const prisma = new PrismaClient();

const projectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']).optional(),
  startDate: z.string().transform((s) => new Date(s)),
  endDate: z.string().transform((s) => new Date(s)).optional(),
  budget: z.number().optional(),
});

router.get('/', authenticate, async (req, res) => {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(projects);
});

router.post('/', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  const data = projectSchema.parse(req.body);

  const project = await prisma.project.create({
    data,
  });

  res.status(201).json(project);
});

router.get('/:id', authenticate, async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
  });

  res.json(project);
});

router.patch('/:id', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  const data = projectSchema.partial().parse(req.body);

  const project = await prisma.project.update({
    where: { id: req.params.id },
    data,
  });

  res.json(project);
});

router.delete('/:id', authenticate, authorize('ADMIN'), async (req, res) => {
  await prisma.project.delete({
    where: { id: req.params.id },
  });

  res.status(204).send();
});

export default router;

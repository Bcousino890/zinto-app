import { useState, useEffect } from 'react';
import apiClient from '@/lib/api';

interface Department {
  id: string;
  name: string;
  code: string;
  description: string;
  budget: number;
}

function Departments() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      const { data } = await apiClient.get('/api/departments');
      setDepartments(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch departments');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Departments</h1>

      {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Budget</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {departments.map((dept) => (
              <tr key={dept.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{dept.code}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{dept.name}</td>
                <td className="px-6 py-4 text-sm text-gray-900">{dept.description}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${dept.budget.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {departments.length === 0 && <p className="text-center text-gray-500 mt-8">No departments found</p>}
    </div>
  );
}

export default Departments;

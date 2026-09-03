import { Link } from 'react-router-dom';
import { IconCar, IconUpload } from '../components/icons';

export function AddExpensePage() {
  return (
    <div className="expense-type-chooser">
      <Link to="/upload/receipt" className="expense-type-card">
        <div className="expense-type-card-icon">
          <IconUpload />
        </div>
        <h3>Upload receipt</h3>
        <p>Snap or upload a photo of a receipt or invoice — we'll extract the details automatically.</p>
      </Link>

      <Link to="/upload/mileage" className="expense-type-card">
        <div className="expense-type-card-icon">
          <IconCar />
        </div>
        <h3>Log mileage</h3>
        <p>Record a trip by distance, or enter a start and end location and we'll calculate it.</p>
      </Link>
    </div>
  );
}

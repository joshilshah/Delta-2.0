import { useParams } from 'react-router-dom';
import { RideCanvas } from '../../components/RideTracker.jsx';

export default function PassengerRide() {
  const { id } = useParams();
  return <RideCanvas key={id} rideId={id} />;
}

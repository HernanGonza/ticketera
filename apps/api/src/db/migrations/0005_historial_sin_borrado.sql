-- El historial tampoco se borra.
CREATE TRIGGER ticket_eventos_sin_borrado BEFORE DELETE ON ticket_eventos
  FOR EACH ROW EXECUTE FUNCTION public.eco_historial_inmutable();

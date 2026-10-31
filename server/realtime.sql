-- Only run on Supabase, where auth and realtime schemas already exist.
-- Existing agents can receive this metadata-only topic. No publish policy is granted.
CREATE OR REPLACE FUNCTION public.verdant_can_receive_events()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$ SELECT EXISTS(SELECT 1 FROM public.agent_memberships WHERE user_id=(SELECT auth.uid())::text AND brand_id='verdant-co') $$;
REVOKE ALL ON FUNCTION public.verdant_can_receive_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verdant_can_receive_events() TO authenticated;
DROP POLICY IF EXISTS verdant_agent_events ON realtime.messages;
CREATE POLICY verdant_agent_events ON realtime.messages FOR SELECT TO authenticated
  USING ((SELECT realtime.topic())='verdant:events' AND (SELECT public.verdant_can_receive_events()));

CREATE OR REPLACE FUNCTION public.verdant_notify_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE conversation uuid; customer text; kind text;
BEGIN
  IF TG_TABLE_NAME='message_receipts' THEN
    SELECT conversation_id INTO conversation FROM public.messages WHERE id=NEW.message_id;
    kind := 'receipt';
  ELSE
    conversation := NEW.conversation_id;
    kind := CASE WHEN TG_TABLE_NAME='drafts' THEN 'draft' ELSE 'message' END;
  END IF;
  SELECT u.external_id INTO customer FROM public.conversations c JOIN public.customers u ON u.id=c.customer_id
    WHERE c.id=conversation AND c.brand_id='verdant-co';
  IF customer IS NOT NULL THEN
    PERFORM realtime.send(jsonb_build_object('kind',kind,'conversationId',conversation,'customerId',customer),'change','verdant:events',true);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A notification outage must not discard a message or approval. Polling recovers.
  RAISE WARNING 'Verdant notification unavailable';
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.verdant_notify_change() FROM PUBLIC;
DROP TRIGGER IF EXISTS verdant_message_event ON public.messages;
CREATE TRIGGER verdant_message_event AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.verdant_notify_change();
DROP TRIGGER IF EXISTS verdant_draft_event ON public.drafts;
CREATE TRIGGER verdant_draft_event AFTER INSERT OR UPDATE OF state ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.verdant_notify_change();
DROP TRIGGER IF EXISTS verdant_receipt_event ON public.message_receipts;
CREATE TRIGGER verdant_receipt_event AFTER INSERT OR UPDATE OF read_at ON public.message_receipts FOR EACH ROW EXECUTE FUNCTION public.verdant_notify_change();
